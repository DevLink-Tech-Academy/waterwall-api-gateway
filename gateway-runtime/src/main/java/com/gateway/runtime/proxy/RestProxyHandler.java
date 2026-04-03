package com.gateway.runtime.proxy;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

import com.gateway.runtime.lb.CircuitBreaker;
import com.gateway.runtime.lb.LoadBalancer;
import com.gateway.runtime.lb.RetryHandler;
import com.gateway.runtime.lb.UpstreamHealthChecker;
import com.gateway.runtime.model.GatewayRoute;
import com.gateway.runtime.model.MatchedRoute;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Handles REST protocol proxying with load balancing, circuit breaker, and retry support.
 * If a route has multiple upstream URLs (comma-separated), the load balancer selects one.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RestProxyHandler implements ProtocolProxyHandler {

    private static final Set<String> HOP_BY_HOP_HEADERS = Set.of(
            "host", "connection", "keep-alive", "proxy-authenticate",
            "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"
    );

    /** CORS headers managed by the gateway — strip from upstream responses to avoid duplicates */
    private static final Set<String> CORS_HEADERS = Set.of(
            "access-control-allow-origin", "access-control-allow-methods",
            "access-control-allow-headers", "access-control-allow-credentials",
            "access-control-expose-headers", "access-control-max-age"
    );

    private final RestClient restClient;
    private final LoadBalancer loadBalancer;
    private final CircuitBreaker circuitBreaker;
    private final RetryHandler retryHandler;
    private final UpstreamHealthChecker upstreamHealthChecker;

    @Override
    public String getProtocolType() {
        return "REST";
    }

    @Override
    public ResponseEntity<byte[]> proxy(HttpServletRequest request, MatchedRoute matchedRoute) {
        long startTime = System.currentTimeMillis();
        GatewayRoute route = matchedRoute.getRoute();

        // Read request body upfront for retries (only for methods that have a body)
        HttpMethod method = HttpMethod.valueOf(request.getMethod().toUpperCase());
        byte[] requestBody = null;
        if (method == HttpMethod.POST || method == HttpMethod.PUT || method == HttpMethod.PATCH) {
            try {
                requestBody = request.getInputStream().readAllBytes();
            } catch (IOException ex) {
                long latency = System.currentTimeMillis() - startTime;
                request.setAttribute("gateway.proxyLatencyMs", latency);
                log.error("Failed to read request body for {} {}: {}", request.getMethod(), request.getRequestURI(), ex.getMessage());
                request.setAttribute("gateway.errorCode", "REQUEST_READ_ERROR");
                return ResponseEntity.status(502)
                        .body("{\"error\":\"bad_gateway\",\"message\":\"Failed to read request body\"}".getBytes());
            }
        }

        // Determine upstream URLs (may be comma-separated for load balancing)
        List<String> upstreamUrls = parseUpstreamUrls(route.getUpstreamUrl());

        // Register upstreams for health checking
        upstreamUrls.forEach(upstreamHealthChecker::registerUpstream);

        // Filter to healthy upstreams
        List<String> healthyUpstreams = upstreamHealthChecker.filterHealthy(upstreamUrls);

        final byte[] body = requestBody;

        ResponseEntity<byte[]> result = retryHandler.executeWithRetry(() -> {
            // Select upstream via load balancer (filters out circuit-broken ones)
            List<String> availableUpstreams = healthyUpstreams.stream()
                    .filter(url -> !circuitBreaker.isOpen(url))
                    .collect(Collectors.toList());

            if (availableUpstreams.isEmpty()) {
                // All circuits open — try all healthy upstreams as fallback
                availableUpstreams = healthyUpstreams;
            }

            String selectedUpstream = loadBalancer.selectUpstream(availableUpstreams);
            String upstreamUrl = buildUpstreamUrl(request, route, selectedUpstream);

            log.debug("REST proxy {} {} -> {}", request.getMethod(), request.getRequestURI(), upstreamUrl);

            try {
                ResponseEntity<byte[]> response = executeUpstreamCall(method, upstreamUrl, request, body);

                // Record success/failure with circuit breaker
                int statusCode = response.getStatusCode().value();
                if (statusCode >= 500) {
                    circuitBreaker.recordFailure(selectedUpstream);
                } else {
                    circuitBreaker.recordSuccess(selectedUpstream);
                }

                return response;
            } catch (ResourceAccessException ex) {
                circuitBreaker.recordFailure(selectedUpstream);
                return handleResourceAccessException(ex, request, upstreamUrl);
            }
        });

        long latency = System.currentTimeMillis() - startTime;
        request.setAttribute("gateway.proxyLatencyMs", latency);

        return result;
    }

    // ── Private helpers ──────────────────────────────────────────────────

    private List<String> parseUpstreamUrls(String upstreamUrl) {
        if (upstreamUrl == null || upstreamUrl.isBlank()) {
            throw new IllegalArgumentException("No upstream URL configured for route");
        }
        return Arrays.stream(upstreamUrl.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toList());
    }

    private ResponseEntity<byte[]> executeUpstreamCall(HttpMethod method, String upstreamUrl,
                                                        HttpServletRequest request, byte[] body) {
        RestClient.RequestBodySpec requestSpec = restClient
                .method(method)
                .uri(URI.create(upstreamUrl))
                .headers(headers -> copyRequestHeaders(request, headers, upstreamUrl));

        if (body != null && body.length > 0) {
            requestSpec.body(body);
        }

        ResponseEntity<byte[]> upstreamResponse = requestSpec
                .retrieve()
                .onStatus(HttpStatusCode::isError, (req, res) -> {
                    // Do not throw — forward upstream error as-is
                })
                .toEntity(byte[].class);

        HttpHeaders responseHeaders = new HttpHeaders();
        upstreamResponse.getHeaders().forEach((name, values) -> {
            String lower = name.toLowerCase();
            if (!HOP_BY_HOP_HEADERS.contains(lower) && !CORS_HEADERS.contains(lower)) {
                responseHeaders.put(name, values);
            }
        });

        return ResponseEntity
                .status(upstreamResponse.getStatusCode())
                .headers(responseHeaders)
                .body(upstreamResponse.getBody());
    }

    private ResponseEntity<byte[]> handleResourceAccessException(ResourceAccessException ex,
                                                                  HttpServletRequest request,
                                                                  String upstreamUrl) {
        Throwable cause = ex.getCause();
        if (cause instanceof java.net.SocketTimeoutException) {
            log.error("Upstream timeout for {} {}: {}", request.getMethod(), upstreamUrl, cause.getMessage());
            request.setAttribute("gateway.errorCode", "UPSTREAM_TIMEOUT");
            return ResponseEntity.status(504)
                    .body("{\"error\":\"gateway_timeout\",\"message\":\"Upstream service timed out\"}".getBytes());
        }
        if (cause instanceof java.net.ConnectException) {
            log.error("Upstream connection refused for {} {}: {}", request.getMethod(), upstreamUrl, cause.getMessage());
            request.setAttribute("gateway.errorCode", "UPSTREAM_CONNECT_REFUSED");
            return ResponseEntity.status(502)
                    .body("{\"error\":\"bad_gateway\",\"message\":\"Upstream service unavailable\"}".getBytes());
        }

        log.error("Upstream error for {} {}: {}", request.getMethod(), upstreamUrl, ex.getMessage());
        request.setAttribute("gateway.errorCode", "UPSTREAM_ERROR");
        return ResponseEntity.status(502)
                .body("{\"error\":\"bad_gateway\",\"message\":\"Error communicating with upstream service\"}".getBytes());
    }

    private String buildUpstreamUrl(HttpServletRequest request, GatewayRoute route, String upstreamBase) {
        String requestPath = request.getRequestURI();
        String routePath = route.getPath();
        String remainingPath;

        if (route.isStripPrefix() && routePath != null) {
            String staticPrefix = routePath.replaceAll("/\\*\\*$", "")
                    .replaceAll("/\\{[^}]+}.*", "");
            if (!staticPrefix.isEmpty() && requestPath.startsWith(staticPrefix)) {
                remainingPath = requestPath.substring(staticPrefix.length());
            } else {
                remainingPath = requestPath;
            }
        } else {
            remainingPath = requestPath;
        }

        if (!remainingPath.isEmpty() && !remainingPath.startsWith("/")) {
            remainingPath = "/" + remainingPath;
        }

        if (upstreamBase.endsWith("/")) {
            upstreamBase = upstreamBase.substring(0, upstreamBase.length() - 1);
        }

        String fullUrl = upstreamBase + remainingPath;

        String queryString = request.getQueryString();
        if (queryString != null && !queryString.isEmpty()) {
            fullUrl = fullUrl + "?" + queryString;
        }

        return fullUrl;
    }

    private void copyRequestHeaders(HttpServletRequest request, HttpHeaders targetHeaders, String upstreamUrl) {
        Enumeration<String> headerNames = request.getHeaderNames();
        while (headerNames.hasMoreElements()) {
            String headerName = headerNames.nextElement();
            if (HOP_BY_HOP_HEADERS.contains(headerName.toLowerCase())) {
                continue;
            }
            Enumeration<String> values = request.getHeaders(headerName);
            while (values.hasMoreElements()) {
                targetHeaders.add(headerName, values.nextElement());
            }
        }

        try {
            URI uri = new URI(upstreamUrl);
            String host = uri.getHost();
            if (uri.getPort() > 0 && uri.getPort() != 80 && uri.getPort() != 443) {
                host = host + ":" + uri.getPort();
            }
            targetHeaders.set(HttpHeaders.HOST, host);
        } catch (URISyntaxException e) {
            log.warn("Could not parse upstream URL for Host header: {}", upstreamUrl);
        }
    }
}

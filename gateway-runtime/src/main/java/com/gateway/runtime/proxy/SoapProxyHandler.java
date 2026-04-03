package com.gateway.runtime.proxy;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Enumeration;
import java.util.Set;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

import com.gateway.runtime.model.GatewayRoute;
import com.gateway.runtime.model.MatchedRoute;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * SOAP protocol proxy handler. Forwards XML requests to upstream SOAP services,
 * preserving the SOAPAction header for proper SOAP operation dispatch.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SoapProxyHandler implements ProtocolProxyHandler {

    private static final Set<String> HOP_BY_HOP_HEADERS = Set.of(
            "host", "connection", "keep-alive", "proxy-authenticate",
            "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"
    );

    private static final Set<String> CORS_HEADERS = Set.of(
            "access-control-allow-origin", "access-control-allow-methods",
            "access-control-allow-headers", "access-control-allow-credentials",
            "access-control-expose-headers", "access-control-max-age"
    );

    private static final String SOAP_ACTION_HEADER = "SOAPAction";

    private final RestClient restClient;

    @Override
    public String getProtocolType() {
        return "SOAP";
    }

    @Override
    public ResponseEntity<byte[]> proxy(HttpServletRequest request, MatchedRoute matchedRoute) {
        long startTime = System.currentTimeMillis();
        GatewayRoute route = matchedRoute.getRoute();
        String upstreamUrl = route.getUpstreamUrl();

        // Extract SOAPAction for routing/logging
        String soapAction = request.getHeader(SOAP_ACTION_HEADER);
        if (soapAction != null) {
            log.info("SOAP proxy {} -> {} SOAPAction={}", request.getRequestURI(), upstreamUrl, soapAction);
            request.setAttribute("gateway.soapAction", soapAction);
        } else {
            log.debug("SOAP proxy {} -> {} (no SOAPAction header)", request.getRequestURI(), upstreamUrl);
        }

        // Validate content type
        String contentType = request.getContentType();
        if (contentType != null
                && !contentType.contains("text/xml")
                && !contentType.contains("application/soap+xml")) {
            log.warn("SOAP proxy received unexpected Content-Type: {}", contentType);
        }

        try {
            byte[] body = request.getInputStream().readAllBytes();

            RestClient.RequestBodySpec requestSpec = restClient
                    .method(HttpMethod.POST)
                    .uri(URI.create(upstreamUrl))
                    .headers(headers -> {
                        copyRequestHeaders(request, headers, upstreamUrl);
                        // Ensure SOAPAction header is forwarded
                        if (soapAction != null) {
                            headers.set(SOAP_ACTION_HEADER, soapAction);
                        }
                        // Preserve XML content type
                        if (contentType != null) {
                            headers.set(HttpHeaders.CONTENT_TYPE, contentType);
                        } else {
                            headers.set(HttpHeaders.CONTENT_TYPE, "text/xml; charset=utf-8");
                        }
                    });

            requestSpec.body(body);

            ResponseEntity<byte[]> upstreamResponse = requestSpec
                    .retrieve()
                    .onStatus(HttpStatusCode::isError, (req, res) -> {
                        // Do not throw — forward upstream SOAP fault as-is
                    })
                    .toEntity(byte[].class);

            // Build response, preserving XML content type
            HttpHeaders responseHeaders = new HttpHeaders();
            upstreamResponse.getHeaders().forEach((name, values) -> {
                String lower = name.toLowerCase();
                if (!HOP_BY_HOP_HEADERS.contains(lower) && !CORS_HEADERS.contains(lower)) {
                    responseHeaders.put(name, values);
                }
            });

            long latency = System.currentTimeMillis() - startTime;
            request.setAttribute("gateway.proxyLatencyMs", latency);

            return ResponseEntity
                    .status(upstreamResponse.getStatusCode())
                    .headers(responseHeaders)
                    .body(upstreamResponse.getBody());

        } catch (ResourceAccessException ex) {
            long latency = System.currentTimeMillis() - startTime;
            request.setAttribute("gateway.proxyLatencyMs", latency);

            Throwable cause = ex.getCause();
            if (cause instanceof java.net.SocketTimeoutException) {
                log.error("SOAP upstream timeout for {}: {}", upstreamUrl, cause.getMessage());
                request.setAttribute("gateway.errorCode", "UPSTREAM_TIMEOUT");
                return ResponseEntity.status(504)
                        .header(HttpHeaders.CONTENT_TYPE, "text/xml")
                        .body(soapFault("Gateway Timeout", "Upstream SOAP service timed out"));
            }
            if (cause instanceof java.net.ConnectException) {
                log.error("SOAP upstream connection refused for {}: {}", upstreamUrl, cause.getMessage());
                request.setAttribute("gateway.errorCode", "UPSTREAM_CONNECT_REFUSED");
                return ResponseEntity.status(502)
                        .header(HttpHeaders.CONTENT_TYPE, "text/xml")
                        .body(soapFault("Bad Gateway", "Upstream SOAP service unavailable"));
            }

            log.error("SOAP upstream error for {}: {}", upstreamUrl, ex.getMessage());
            request.setAttribute("gateway.errorCode", "UPSTREAM_ERROR");
            return ResponseEntity.status(502)
                    .header(HttpHeaders.CONTENT_TYPE, "text/xml")
                    .body(soapFault("Bad Gateway", "Error communicating with upstream SOAP service"));

        } catch (IOException ex) {
            long latency = System.currentTimeMillis() - startTime;
            request.setAttribute("gateway.proxyLatencyMs", latency);

            log.error("Failed to read SOAP request body: {}", ex.getMessage());
            request.setAttribute("gateway.errorCode", "REQUEST_READ_ERROR");
            return ResponseEntity.status(502)
                    .header(HttpHeaders.CONTENT_TYPE, "text/xml")
                    .body(soapFault("Bad Gateway", "Failed to read request body"));
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

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

    private byte[] soapFault(String faultCode, String faultString) {
        return ("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\">"
                + "<soap:Body><soap:Fault>"
                + "<faultcode>" + faultCode + "</faultcode>"
                + "<faultstring>" + faultString + "</faultstring>"
                + "</soap:Fault></soap:Body></soap:Envelope>").getBytes();
    }
}

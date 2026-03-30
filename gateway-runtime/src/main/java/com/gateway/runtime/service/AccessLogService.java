package com.gateway.runtime.service;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.time.Instant;
import java.util.UUID;

import org.slf4j.MDC;
import org.springframework.stereotype.Service;

import com.gateway.common.events.BaseEvent;
import com.gateway.common.events.EventPublisher;
import com.gateway.common.events.RabbitMQExchanges;
import com.gateway.runtime.model.MatchedRoute;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Publishes access-log events to the analytics ingest exchange after each
 * proxied request. Events are consumed by the analytics service for
 * dashboards, alerting, and usage metering.
 *
 * <p>Now includes distributed tracing fields (traceId, spanId) and separate
 * upstream vs gateway latency breakdowns for end-to-end observability.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccessLogService {

    private static final String GATEWAY_NODE = resolveHostname();

    private final EventPublisher eventPublisher;

    /**
     * Build and publish an access-log event for a completed request.
     *
     * @param request           the original client request
     * @param statusCode        HTTP status code returned to the client
     * @param totalLatencyMs    total end-to-end latency in milliseconds
     * @param upstreamLatencyMs time spent waiting for the upstream backend
     * @param gatewayLatencyMs  time spent in gateway processing (filters, auth, etc.)
     * @param requestSize       request body size in bytes
     * @param responseSize      response body size in bytes
     * @param traceId           distributed trace identifier
     * @param spanId            span identifier for this service hop
     */
    public void logRequest(HttpServletRequest request, int statusCode,
                           long totalLatencyMs, long upstreamLatencyMs,
                           long gatewayLatencyMs, long requestSize,
                           long responseSize, String traceId, String spanId) {
        try {
            AccessLogEvent event = buildEvent(request, statusCode, totalLatencyMs,
                    upstreamLatencyMs, gatewayLatencyMs, requestSize, responseSize,
                    traceId, spanId);
            eventPublisher.publish(RabbitMQExchanges.ANALYTICS_INGEST, "request.logged", event);
            log.info("Published access log: trace={} {} {} -> {} ({}ms)",
                    traceId, request.getMethod(), request.getRequestURI(), statusCode, totalLatencyMs);
        } catch (Exception ex) {
            log.error("Failed to publish access log event: {}", ex.getMessage(), ex);
        }
    }

    private AccessLogEvent buildEvent(HttpServletRequest request, int statusCode,
                                      long totalLatencyMs, long upstreamLatencyMs,
                                      long gatewayLatencyMs, long requestSize,
                                      long responseSize, String traceId, String spanId) {

        // Route info from request attributes (set by RouteMatchingFilter)
        MatchedRoute matchedRoute = (MatchedRoute) request.getAttribute("gateway.matchedRoute");
        String apiId = null;
        String routeId = null;
        String apiName = null;
        String authType = null;
        if (matchedRoute != null) {
            apiId = matchedRoute.getRoute().getApiId() != null
                    ? matchedRoute.getRoute().getApiId().toString() : null;
            routeId = matchedRoute.getRoute().getRouteId() != null
                    ? matchedRoute.getRoute().getRouteId().toString() : null;
            apiName = matchedRoute.getRoute().getApiName();
            if (matchedRoute.getRoute().getAuthTypes() != null && !matchedRoute.getRoute().getAuthTypes().isEmpty()) {
                authType = String.join(",", matchedRoute.getRoute().getAuthTypes());
            }
        }

        // Consumer / application info — try request attributes first, then SecurityContext
        String consumerId = (String) request.getAttribute("gateway.consumerId");
        String applicationId = (String) request.getAttribute("gateway.applicationId");

        // Fallback: read from SecurityContext directly
        if (consumerId == null || applicationId == null) {
            var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
            if (auth instanceof com.gateway.common.auth.GatewayAuthentication ga) {
                if (consumerId == null && ga.getUserId() != null) consumerId = ga.getUserId();
                if (applicationId == null && ga.getAppId() != null) applicationId = ga.getAppId();
            }
        }

        // Last resort: extract consumer info directly from request headers
        if (consumerId == null) {
            // From JWT Bearer token
            String authHeader = request.getHeader("Authorization");
            if (authHeader != null && authHeader.startsWith("Bearer ")) {
                try {
                    String tokenPayload = authHeader.substring(7).split("\\.")[1];
                    tokenPayload += "=".repeat((4 - tokenPayload.length() % 4) % 4);
                    String json = new String(java.util.Base64.getUrlDecoder().decode(tokenPayload));
                    com.fasterxml.jackson.databind.JsonNode claims = new com.fasterxml.jackson.databind.ObjectMapper().readTree(json);
                    if (claims.has("sub")) consumerId = claims.get("sub").asText();
                    if (claims.has("app_id") && applicationId == null) applicationId = claims.get("app_id").asText();
                } catch (Exception ignored) { /* best-effort */ }
            }
            // From API Key — mark auth type as API_KEY if header present
            String apiKeyHeader = request.getHeader("X-API-Key");
            if (apiKeyHeader != null && !apiKeyHeader.isBlank() && consumerId == null) {
                // We can't resolve the app ID without calling identity-service again,
                // but at least mark that an API key was used
                authType = "API_KEY";
            }
        }

        // Error code (set by ProxyController on upstream errors)
        String errorCode = (String) request.getAttribute("gateway.errorCode");

        // Mock mode flag (set by MockModeFilter)
        boolean mockMode = Boolean.TRUE.equals(request.getAttribute("gateway.mockMode"));

        // Client IP: prefer X-Forwarded-For, fall back to remoteAddr
        String clientIp = request.getHeader("X-Forwarded-For");
        if (clientIp == null || clientIp.isBlank()) {
            clientIp = request.getRemoteAddr();
        } else {
            // Take the first IP if there are multiple
            clientIp = clientIp.split(",")[0].trim();
        }

        String userAgent = request.getHeader("User-Agent");

        return AccessLogEvent.builder()
                .eventType("request.logged")
                .actorId(consumerId)
                .traceId(traceId)
                .spanId(spanId)
                .apiId(apiId)
                .routeId(routeId)
                .apiName(apiName)
                .consumerId(consumerId)
                .applicationId(applicationId)
                .method(request.getMethod())
                .path(request.getRequestURI())
                .statusCode(statusCode)
                .latencyMs(totalLatencyMs)
                .upstreamLatencyMs(upstreamLatencyMs)
                .gatewayLatencyMs(gatewayLatencyMs)
                .requestSize(requestSize)
                .responseSize(responseSize)
                .authType(authType)
                .clientIp(clientIp)
                .userAgent(userAgent)
                .errorCode(errorCode)
                .gatewayNode(GATEWAY_NODE)
                .mockMode(mockMode)
                .build();
    }

    private static String resolveHostname() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (UnknownHostException e) {
            return "unknown";
        }
    }

    // -- Inner event class ────────────────────────────────────────────────

    @lombok.Data
    @lombok.NoArgsConstructor
    @lombok.AllArgsConstructor
    @lombok.experimental.SuperBuilder
    @lombok.EqualsAndHashCode(callSuper = true)
    public static class AccessLogEvent extends BaseEvent {
        private String spanId;
        private String apiId;
        private String routeId;
        private String apiName;
        private String consumerId;
        private String applicationId;
        private String method;
        private String path;
        private int statusCode;
        private long latencyMs;
        private long upstreamLatencyMs;
        private long gatewayLatencyMs;
        private long requestSize;
        private long responseSize;
        private String authType;
        private String clientIp;
        private String userAgent;
        private String errorCode;
        private String gatewayNode;
        private boolean mockMode;
    }
}

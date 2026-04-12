package com.gateway.runtime.filter;

import java.io.IOException;

import org.slf4j.MDC;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.util.ContentCachingResponseWrapper;

import com.gateway.runtime.service.AccessLogService;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Outermost filter (Order 100 — runs last in the chain) that wraps every
 * request to capture timing and payload sizes, then publishes an access-log
 * event after the response has been written.
 *
 * <p>Uses {@link ContentCachingResponseWrapper} to capture the response body
 * size and status code reliably even when the downstream chain modifies them.</p>
 *
 * <p>Records both the total gateway latency (time spent in the full filter chain)
 * and the upstream latency (time the proxied backend took), allowing operators to
 * distinguish gateway overhead from upstream processing time. Upstream latency is
 * expected to be set as a request attribute ({@code gateway.upstreamLatencyMs}) by
 * the proxy controller.</p>
 */
@Slf4j
@Component
@Order(3)
@RequiredArgsConstructor
public class AccessLogFilter implements Filter {

    private final AccessLogService accessLogService;

    /** Request attribute key set by the proxy controller with upstream round-trip time. */
    private static final String UPSTREAM_LATENCY_ATTR = "gateway.upstreamLatencyMs";

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse,
                         FilterChain filterChain) throws IOException, ServletException {

        if (!(servletRequest instanceof HttpServletRequest request)
                || !(servletResponse instanceof HttpServletResponse response)) {
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        // Skip actuator and health-check endpoints
        String path = request.getRequestURI();
        if (path.startsWith("/actuator") || path.contains("/actuator/")) {
            filterChain.doFilter(request, response);
            return;
        }

        long startTime = System.currentTimeMillis();
        long requestSize = request.getContentLengthLong() > 0 ? request.getContentLengthLong() : 0;

        try {
            filterChain.doFilter(request, response);
        } finally {
            long totalLatencyMs = System.currentTimeMillis() - startTime;
            int statusCode = response.getStatus();
            // Get response size from Content-Length header instead of buffering entire body
            long responseSize = 0;
            String contentLength = response.getHeader("Content-Length");
            if (contentLength != null) {
                try { responseSize = Long.parseLong(contentLength); } catch (NumberFormatException ignored) {}
            }

            // Upstream latency (set by ProxyController); 0 if not proxied
            long upstreamLatencyMs = 0;
            Object upstreamAttr = request.getAttribute(UPSTREAM_LATENCY_ATTR);
            if (upstreamAttr instanceof Number) {
                upstreamLatencyMs = ((Number) upstreamAttr).longValue();
            }
            long gatewayLatencyMs = totalLatencyMs - upstreamLatencyMs;

            // Trace context from MDC (populated by TraceIdFilter)
            String traceId = MDC.get("traceId");
            String spanId = MDC.get("spanId");

            // Publish access log (consumer/application IDs set by GatewayAuthFilter as request attributes)
            try {
                accessLogService.logRequest(
                        request, statusCode, totalLatencyMs, upstreamLatencyMs,
                        gatewayLatencyMs, requestSize, responseSize, traceId, spanId);
            } catch (Exception ex) {
                log.error("AccessLogFilter: failed to log request: {}", ex.getMessage());
            }

        }
    }
}

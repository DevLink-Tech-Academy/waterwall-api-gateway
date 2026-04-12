package com.gateway.runtime.filter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.common.dto.ApiErrorResponse;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Order(2) — Tracks active concurrent requests and returns 503 Service Unavailable
 * with a Retry-After header when the gateway is overloaded. This prevents TCP
 * connection drops and enables graceful degradation under load.
 */
@Slf4j
@Component
@Order(2)
public class BackpressureFilter implements Filter {

    private final ObjectMapper objectMapper;
    private final AtomicInteger activeRequests = new AtomicInteger(0);

    @Value("${gateway.runtime.backpressure.max-concurrent:500}")
    private int maxConcurrent;

    @Value("${gateway.runtime.backpressure.retry-after-seconds:2}")
    private int retryAfterSeconds;

    public BackpressureFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain chain)
            throws IOException, ServletException {

        int current = activeRequests.incrementAndGet();

        try {
            if (current > maxConcurrent) {
                HttpServletRequest request = (HttpServletRequest) servletRequest;
                HttpServletResponse response = (HttpServletResponse) servletResponse;

                log.warn("Backpressure triggered: {}/{} active requests, rejecting {} {}",
                        current, maxConcurrent, request.getMethod(), request.getRequestURI());

                ApiErrorResponse error = ApiErrorResponse.builder()
                        .status(503)
                        .error("SERVICE_UNAVAILABLE")
                        .errorCode("GW_503")
                        .message("Gateway is temporarily overloaded. Please retry shortly.")
                        .path(request.getRequestURI())
                        .build();

                response.setStatus(503);
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                response.setHeader("Retry-After", String.valueOf(retryAfterSeconds));
                objectMapper.writeValue(response.getOutputStream(), error);
                return;
            }

            chain.doFilter(servletRequest, servletResponse);
        } finally {
            activeRequests.decrementAndGet();
        }
    }

    /**
     * Returns the current number of active concurrent requests.
     * Useful for monitoring/debug endpoints.
     */
    public int getActiveRequests() {
        return activeRequests.get();
    }
}

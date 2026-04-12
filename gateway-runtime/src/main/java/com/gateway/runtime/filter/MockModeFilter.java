package com.gateway.runtime.filter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.runtime.model.MatchedRoute;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Order(35) — After route match (30), before subscription check (40).
 * If mock mode is active (via X-Mock-Mode header or API-level mock config),
 * returns a mock response directly without calling the upstream service.
 */
@Slf4j
@Component
@Order(35)
@RequiredArgsConstructor
public class MockModeFilter implements Filter {

    private static final String MOCK_MODE_HEADER = "X-Mock-Mode";
    private static final String MOCK_RESPONSE_HEADER = "X-Mock";
    public static final String ATTR_MOCK_MODE = "gateway.mockMode";

    private final JdbcTemplate gatewayJdbcTemplate;
    private final ObjectMapper objectMapper;

    // Cache mock-enabled status per API (30s TTL) to avoid DB hit per request
    private final java.util.concurrent.ConcurrentHashMap<UUID, CachedMockStatus> mockStatusCache = new java.util.concurrent.ConcurrentHashMap<>();
    private static final long MOCK_CACHE_TTL_MS = 30_000;
    private record CachedMockStatus(boolean enabled, long expiresAt) {}

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) servletRequest;
        HttpServletResponse response = (HttpServletResponse) servletResponse;

        MatchedRoute matchedRoute = (MatchedRoute) request.getAttribute(RouteMatchFilter.ATTR_MATCHED_ROUTE);
        if (matchedRoute == null) {
            // No route matched yet, pass through
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        UUID apiId = matchedRoute.getRoute().getApiId();
        boolean mockRequested = "true".equalsIgnoreCase(request.getHeader(MOCK_MODE_HEADER));

        // Check if mock mode is enabled for this API at the config level
        boolean mockEnabledForApi = false;
        if (!mockRequested) {
            mockEnabledForApi = isMockEnabledForApi(apiId);
        }

        if (!mockRequested && !mockEnabledForApi) {
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        // Mark request as mock so AccessLogFilter can tag it (exclude from billing)
        request.setAttribute(ATTR_MOCK_MODE, true);

        log.debug("Mock mode active for apiId={} (header={}, config={})", apiId, mockRequested, mockEnabledForApi);

        // Look up mock config for this API, path, and method
        String requestPath = request.getRequestURI();
        String requestMethod = request.getMethod().toUpperCase();

        MockConfig mockConfig = findMockConfig(apiId, requestPath, requestMethod);

        if (mockConfig == null) {
            // Return a default mock response
            writeMockResponse(response, 200, "{\"message\":\"Mock response (no config found)\"}", null);
            return;
        }

        // Simulate latency
        if (mockConfig.latencyMs > 0) {
            try {
                Thread.sleep(mockConfig.latencyMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }

        // Simulate errors based on error_rate_percent
        if (mockConfig.errorRatePercent > 0) {
            int roll = java.util.concurrent.ThreadLocalRandom.current().nextInt(100);
            if (roll < mockConfig.errorRatePercent) {
                writeMockResponse(response, 500,
                        "{\"error\":\"Simulated error\",\"message\":\"Mock error simulation triggered\"}",
                        null);
                return;
            }
        }

        writeMockResponse(response, mockConfig.statusCode, mockConfig.responseBody, mockConfig.responseHeaders);
    }

    private boolean isMockEnabledForApi(UUID apiId) {
        long now = System.currentTimeMillis();
        CachedMockStatus cached = mockStatusCache.get(apiId);
        if (cached != null && now < cached.expiresAt()) {
            return cached.enabled();
        }
        try {
            String sql = "SELECT COUNT(*) FROM gateway.mock_configs WHERE api_id = ? AND mock_enabled = true";
            Integer count = gatewayJdbcTemplate.queryForObject(sql, Integer.class, apiId);
            boolean enabled = count != null && count > 0;
            mockStatusCache.put(apiId, new CachedMockStatus(enabled, now + MOCK_CACHE_TTL_MS));
            return enabled;
        } catch (Exception e) {
            mockStatusCache.put(apiId, new CachedMockStatus(false, now + MOCK_CACHE_TTL_MS));
            log.debug("Failed to check mock mode for apiId={}: {}", apiId, e.getMessage());
            return false;
        }
    }

    private MockConfig findMockConfig(UUID apiId, String requestPath, String requestMethod) {
        try {
            // Try exact match first, then wildcard path/method
            String sql = """
                SELECT status_code, response_body, response_headers, latency_ms, error_rate_percent
                FROM gateway.mock_configs
                WHERE api_id = ? AND mock_enabled = true
                  AND (path = ? OR path = '/**')
                  AND (method = ? OR method = '*')
                ORDER BY
                  CASE WHEN path = ? THEN 0 ELSE 1 END,
                  CASE WHEN method = ? THEN 0 ELSE 1 END
                LIMIT 1
                """;

            List<MockConfig> results = gatewayJdbcTemplate.query(sql,
                    (rs, rowNum) -> {
                        MockConfig config = new MockConfig();
                        config.statusCode = rs.getInt("status_code");
                        config.responseBody = rs.getString("response_body");
                        config.responseHeaders = rs.getString("response_headers");
                        config.latencyMs = rs.getInt("latency_ms");
                        config.errorRatePercent = rs.getInt("error_rate_percent");
                        return config;
                    },
                    apiId, requestPath, requestMethod, requestPath, requestMethod);

            return results.isEmpty() ? null : results.get(0);

        } catch (Exception e) {
            log.debug("Failed to find mock config for apiId={}: {}", apiId, e.getMessage());
            return null;
        }
    }

    private void writeMockResponse(HttpServletResponse response, int statusCode,
                                    String body, String headersJson) throws IOException {
        response.setStatus(statusCode);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader(MOCK_RESPONSE_HEADER, "true");

        // Apply custom headers
        if (headersJson != null && !headersJson.isBlank()) {
            try {
                @SuppressWarnings("unchecked")
                Map<String, String> headers = objectMapper.readValue(headersJson, Map.class);
                if (headers != null) {
                    headers.forEach(response::setHeader);
                }
            } catch (Exception e) {
                log.debug("Failed to parse mock response headers: {}", e.getMessage());
            }
        }

        if (body != null) {
            response.getOutputStream().write(body.getBytes());
        }
        response.getOutputStream().flush();
    }

    private static class MockConfig {
        int statusCode;
        String responseBody;
        String responseHeaders;
        int latencyMs;
        int errorRatePercent;
    }
}

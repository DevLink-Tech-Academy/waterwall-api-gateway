package com.gateway.runtime.filter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.runtime.model.MatchedRoute;
import com.gateway.runtime.service.RouteConfigService;
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
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Order(5) — Runs first in the filter chain. Adds configurable security
 * headers to every HTTP response to protect against common web vulnerabilities
 * (clickjacking, MIME-sniffing, XSS, etc.).
 * <p>
 * Supports per-API CORS origin overrides via the API's gateway_config JSONB
 * field {@code security.corsOrigins}.
 */
@Slf4j
@Component
@Order(9)
public class SecurityHeadersFilter implements Filter {

    @Value("${gateway.runtime.security.headers.hsts-max-age:31536000}")
    private long hstsMaxAge;

    @Value("${gateway.runtime.security.headers.frame-options:DENY}")
    private String frameOptions;

    @Value("${gateway.runtime.security.headers.content-security-policy:default-src 'self'}")
    private String contentSecurityPolicy;

    @Value("${gateway.runtime.security.headers.referrer-policy:strict-origin-when-cross-origin}")
    private String referrerPolicy;

    @Value("${gateway.runtime.security.headers.permissions-policy:}")
    private String permissionsPolicy;

    @Value("${gateway.runtime.security.cors.default-origin:*}")
    private String defaultCorsOrigin;

    private final RouteConfigService routeConfigService;
    private final ObjectMapper objectMapper;

    public SecurityHeadersFilter(RouteConfigService routeConfigService, ObjectMapper objectMapper) {
        this.routeConfigService = routeConfigService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse,
                         FilterChain filterChain) throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) servletRequest;

        if (servletResponse instanceof HttpServletResponse response) {
            // Global security headers
            response.setHeader("Strict-Transport-Security",
                    "max-age=" + hstsMaxAge + "; includeSubDomains");
            response.setHeader("X-Frame-Options", frameOptions);
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.setHeader("X-XSS-Protection", "1; mode=block");
            response.setHeader("Referrer-Policy", referrerPolicy);

            if (contentSecurityPolicy != null && !contentSecurityPolicy.isBlank()) {
                response.setHeader("Content-Security-Policy", contentSecurityPolicy);
            }
            if (permissionsPolicy != null && !permissionsPolicy.isBlank()) {
                response.setHeader("Permissions-Policy", permissionsPolicy);
            }

            // Default global CORS origin
            response.setHeader("Access-Control-Allow-Origin", defaultCorsOrigin);

            // Per-API CORS override
            applyCorsOverride(request, response);
        }

        filterChain.doFilter(servletRequest, servletResponse);
    }

    /**
     * If the request has a matched route, load the API's gatewayConfig from
     * RouteConfigService and check for security.corsOrigins. If the request
     * Origin is in the per-API allowed list, set that origin; otherwise keep
     * the global default.
     */
    private void applyCorsOverride(HttpServletRequest request, HttpServletResponse response) {
        MatchedRoute matchedRoute = (MatchedRoute) request.getAttribute(RouteMatchFilter.ATTR_MATCHED_ROUTE);
        if (matchedRoute == null || matchedRoute.getRoute().getApiId() == null) {
            return;
        }

        UUID apiId = matchedRoute.getRoute().getApiId();
        String configJson = routeConfigService.getGatewayConfig(apiId);
        if (configJson == null || configJson.isBlank()) {
            return;
        }

        try {
            JsonNode config = objectMapper.readTree(configJson);
            JsonNode securityNode = config.get("security");
            if (securityNode == null || !securityNode.has("corsOrigins")) {
                return;
            }

            JsonNode corsOriginsNode = securityNode.get("corsOrigins");
            if (!corsOriginsNode.isArray() || corsOriginsNode.isEmpty()) {
                return;
            }

            List<String> allowedOrigins = new ArrayList<>();
            for (JsonNode originNode : corsOriginsNode) {
                allowedOrigins.add(originNode.asText());
            }

            String requestOrigin = request.getHeader("Origin");
            if (requestOrigin != null && allowedOrigins.contains(requestOrigin)) {
                // Request origin matches per-API allowed list — set it
                response.setHeader("Access-Control-Allow-Origin", requestOrigin);
                response.setHeader("Vary", "Origin");
                log.debug("Per-API CORS: allowed origin '{}' for API {}", requestOrigin, apiId);
            } else if (requestOrigin != null) {
                // Request origin not in per-API list — keep global default
                log.debug("Per-API CORS: origin '{}' not in allowed list for API {}, using global default",
                        requestOrigin, apiId);
            }
        } catch (Exception e) {
            log.warn("Failed to parse gateway_config for API {} for CORS override: {}", apiId, e.getMessage());
        }
    }
}

package com.gateway.runtime.filter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.common.dto.ApiErrorResponse;
import com.gateway.runtime.model.MatchedRoute;
import com.gateway.runtime.service.RouteMatcherService;
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
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Optional;
import java.util.List;

/**
 * Order(30) — Matches the incoming request path and HTTP method against the configured
 * gateway routes. Stores the {@link MatchedRoute} as a request attribute for downstream
 * filters. Rejects unmatched requests with 404 and unauthenticated requests to
 * auth-required routes with 401.
 */
@Slf4j
@Component
@Order(5)
@RequiredArgsConstructor
public class RouteMatchFilter implements Filter {

    public static final String ATTR_MATCHED_ROUTE = "gateway.matchedRoute";

    private final RouteMatcherService routeMatcherService;
    private final ObjectMapper objectMapper;

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) servletRequest;
        HttpServletResponse response = (HttpServletResponse) servletResponse;

        String path = request.getRequestURI();
        String method = request.getMethod();

        // Skip internal management and actuator endpoints
        if (path.startsWith("/v1/gateway/") || path.startsWith("/actuator/")) {
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        MatchedRoute matchedRoute = routeMatcherService.match(path, method);

        if (matchedRoute == null) {
            log.debug("No route matched for {} {}", method, path);
            writeErrorResponse(response, request, HttpServletResponse.SC_NOT_FOUND,
                    "ROUTE_NOT_FOUND", "GW_404", "No route matches " + method + " " + path);
            return;
        }

        request.setAttribute(ATTR_MATCHED_ROUTE, matchedRoute);

        // Check if route requires authentication
        List<String> requiredAuthTypes = matchedRoute.getRoute().getAuthTypes();
        if (requiredAuthTypes != null && !requiredAuthTypes.isEmpty()) {
            String providedAuthType = (String) request.getAttribute(GatewayAuthFilter.ATTR_AUTH_TYPE);

            if (GatewayAuthFilter.AUTH_TYPE_ANONYMOUS.equals(providedAuthType)) {
                log.debug("Route {} {} requires auth {} but request is anonymous",
                        method, path, requiredAuthTypes);
                writeErrorResponse(response, request, HttpServletResponse.SC_UNAUTHORIZED,
                        "AUTHENTICATION_REQUIRED", "GW_401",
                        "This route requires authentication via: " + requiredAuthTypes);
                return;
            }

            if (!requiredAuthTypes.contains(providedAuthType)) {
                log.debug("Route {} {} requires auth {} but got {}",
                        method, path, requiredAuthTypes, providedAuthType);
                writeErrorResponse(response, request, HttpServletResponse.SC_UNAUTHORIZED,
                        "AUTH_TYPE_MISMATCH", "GW_401",
                        "This route requires authentication via: " + requiredAuthTypes);
                return;
            }
        }

        log.debug("Route matched: {} {} -> {}", method, path, matchedRoute.getRoute().getRouteId());
        filterChain.doFilter(servletRequest, servletResponse);
    }

    private void writeErrorResponse(HttpServletResponse response, HttpServletRequest request,
                                    int status, String error, String errorCode,
                                    String message) throws IOException {
        ApiErrorResponse errorBody = ApiErrorResponse.builder()
                .status(status)
                .error(error)
                .errorCode(errorCode)
                .message(message)
                .path(request.getRequestURI())
                .build();
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), errorBody);
    }
}

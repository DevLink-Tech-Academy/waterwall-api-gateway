package com.gateway.runtime.filter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.common.auth.GatewayAuthentication;
import com.gateway.common.dto.ApiErrorResponse;
import com.gateway.runtime.model.GatewayPlan;
import com.gateway.runtime.model.GatewaySubscription;
import com.gateway.runtime.model.MatchedRoute;
import com.gateway.runtime.service.RouteConfigService;
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
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;

/**
 * Order(40) — Verifies that the authenticated application has an active subscription
 * to the API being accessed. Stores the subscription and plan details as request
 * attributes for downstream filters (e.g., rate limiting).
 */
@Slf4j
@Component
@Order(40)
@RequiredArgsConstructor
public class SubscriptionCheckFilter implements Filter {

    public static final String ATTR_SUBSCRIPTION = "gateway.subscription";
    public static final String ATTR_PLAN = "gateway.plan";

    private final RouteConfigService routeConfigService;
    private final ObjectMapper objectMapper;
    private final org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) servletRequest;
        HttpServletResponse response = (HttpServletResponse) servletResponse;

        // Anonymous requests that passed route auth check don't need subscription
        String authType = (String) request.getAttribute(GatewayAuthFilter.ATTR_AUTH_TYPE);
        if (GatewayAuthFilter.AUTH_TYPE_ANONYMOUS.equals(authType)) {
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        GatewayAuthentication authentication = getAuthentication();
        if (authentication == null) {
            log.warn("SubscriptionCheckFilter: no authentication found in SecurityContext");
            writeErrorResponse(response, request, HttpServletResponse.SC_UNAUTHORIZED,
                    "UNAUTHORIZED", "GW_401", "Authentication required");
            return;
        }

        String appIdStr = authentication.getAppId();
        if (appIdStr == null) {
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }
        UUID appId = UUID.fromString(appIdStr);

        MatchedRoute matchedRoute = (MatchedRoute) request.getAttribute(RouteMatchFilter.ATTR_MATCHED_ROUTE);
        if (matchedRoute == null) {
            log.error("SubscriptionCheckFilter: no matched route found in request attributes");
            writeErrorResponse(response, request, HttpServletResponse.SC_INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR", "GW_500", "Internal routing error");
            return;
        }

        UUID apiId = matchedRoute.getRoute().getApiId();
        String environment = (String) request.getAttribute(GatewayAuthFilter.ATTR_ENVIRONMENT);

        java.util.Optional<GatewaySubscription> subOpt = routeConfigService.getSubscription(appId, apiId, environment);
        if (subOpt.isEmpty()) {
            // Check if a suspended/cancelled subscription exists to give a better error message
            String reason = lookupSubscriptionBlockReason(appId, apiId, environment);
            log.debug("No active subscription for appId={} apiId={} env={} reason={}", appId, apiId, environment, reason);
            writeErrorResponse(response, request, HttpServletResponse.SC_FORBIDDEN,
                    "SUBSCRIPTION_REQUIRED", "GW_403", reason);
            return;
        }

        GatewaySubscription subscription = subOpt.get();
        request.setAttribute(ATTR_SUBSCRIPTION, subscription);

        Map<UUID, GatewayPlan> plans = routeConfigService.getPlansById();
        GatewayPlan plan = plans.get(subscription.getPlanId());
        if (plan != null) {
            request.setAttribute(ATTR_PLAN, plan);
        }

        log.debug("Subscription verified: appId={}, apiId={}, planId={}",
                appId, apiId, subscription.getPlanId());

        // In PAY_AS_YOU_GO mode, check wallet balance
        if (isPayAsYouGoMode() && hasEmptyWallet(appId)) {
            log.debug("Wallet empty for appId={} in PAY_AS_YOU_GO mode", appId);
            writeErrorResponse(response, request, HttpServletResponse.SC_PAYMENT_REQUIRED,
                    "INSUFFICIENT_BALANCE", "GW_402",
                    "Your wallet balance is empty. Please top up your wallet to continue using this API.");
            return;
        }

        filterChain.doFilter(servletRequest, servletResponse);
    }

    private String lookupSubscriptionBlockReason(UUID appId, UUID apiId, String environment) {
        try {
            String sql = "SELECT status FROM gateway.subscriptions " +
                    "WHERE application_id = ? AND api_id = ? " +
                    (environment != null ? "AND environment_slug = ? " : "") +
                    "ORDER BY created_at DESC LIMIT 1";

            Object[] params = environment != null
                    ? new Object[]{appId, apiId, environment}
                    : new Object[]{appId, apiId};

            java.util.List<String> statuses = jdbcTemplate.queryForList(sql, String.class, params);
            if (!statuses.isEmpty()) {
                String status = statuses.get(0);
                return switch (status) {
                    case "SUSPENDED" -> "Your subscription has been suspended due to non-payment. Please settle outstanding invoices to restore access.";
                    case "CANCELLED" -> "Your subscription has been cancelled due to non-payment. Please create a new subscription to regain access.";
                    case "REJECTED" -> "Your subscription request was rejected.";
                    case "PENDING" -> "Your subscription is pending approval.";
                    case "EXPIRED" -> "Your subscription has expired. Please renew to continue accessing this API.";
                    default -> "An active subscription is required to access this API.";
                };
            }
        } catch (Exception e) {
            log.debug("Failed to lookup subscription block reason: {}", e.getMessage());
        }
        return "An active subscription is required to access this API.";
    }

    private boolean isPayAsYouGoMode() {
        try {
            String mode = jdbcTemplate.queryForObject(
                    "SELECT setting_value FROM gateway.platform_settings WHERE setting_key = 'billing_mode'",
                    String.class);
            return "PAY_AS_YOU_GO".equals(mode);
        } catch (Exception e) {
            return false;
        }
    }

    private boolean hasEmptyWallet(UUID appId) {
        try {
            // Check wallet for the app's owner (user_id from identity.applications)
            // Also check directly by appId in case consumer_id is the appId
            java.math.BigDecimal balance = jdbcTemplate.queryForObject(
                    "SELECT COALESCE(w.balance, 0) FROM gateway.wallets w " +
                    "WHERE w.consumer_id = ? " +
                    "OR w.consumer_id = (SELECT user_id FROM identity.applications WHERE id = ? LIMIT 1) " +
                    "ORDER BY w.balance DESC LIMIT 1",
                    java.math.BigDecimal.class, appId, appId);
            return balance == null || balance.signum() <= 0;
        } catch (Exception e) {
            // No wallet found — treat as empty
            log.debug("Wallet lookup failed for appId={}: {}", appId, e.getMessage());
            return true;
        }
    }

    private GatewayAuthentication getAuthentication() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof GatewayAuthentication gatewayAuth) {
            return gatewayAuth;
        }
        return null;
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

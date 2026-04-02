package com.gateway.runtime.filter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.common.auth.GatewayAuthentication;
import com.gateway.common.dto.ApiErrorResponse;
import com.gateway.runtime.model.GatewayPlan;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Order(51) — Enforces monthly API usage quotas based on the subscription plan.
 * Runs immediately after the {@link RateLimitFilter} (Order 50).
 *
 * <p>Uses an in-memory counter per application (keyed by app UUID) to track
 * monthly request counts without adding per-request database overhead.
 * Counters are periodically synchronised with the actual database counts
 * from {@code analytics.request_logs} every 5 minutes via {@code @Scheduled}.</p>
 *
 * <p>Supports two enforcement modes:</p>
 * <ul>
 *   <li><b>STRICT</b> — blocks the request with HTTP 429 when the quota is exceeded</li>
 *   <li><b>SOFT</b> — logs a warning but allows the request through</li>
 * </ul>
 */
@Slf4j
@Component
@Order(42)
public class QuotaEnforcementFilter implements Filter {

    private final ObjectMapper objectMapper;
    private final JdbcTemplate jdbcTemplate;

    /**
     * In-memory counters tracking monthly request usage per application.
     * Key: application UUID, Value: atomic counter for the current month.
     */
    private final ConcurrentHashMap<UUID, AtomicLong> usageCounters = new ConcurrentHashMap<>();

    /**
     * Tracks which month the current counters belong to, so we can reset
     * them when a new month begins.
     */
    private volatile YearMonth currentMonth = YearMonth.now();

    public QuotaEnforcementFilter(ObjectMapper objectMapper, JdbcTemplate gatewayJdbcTemplate) {
        this.objectMapper = objectMapper;
        this.jdbcTemplate = gatewayJdbcTemplate;
    }

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) servletRequest;
        HttpServletResponse response = (HttpServletResponse) servletResponse;

        GatewayPlan plan = (GatewayPlan) request.getAttribute(SubscriptionCheckFilter.ATTR_PLAN);

        // If no plan or no monthly quota configured, pass through
        if (plan == null || plan.getMaxRequestsPerMonth() == null || plan.getMaxRequestsPerMonth() <= 0) {
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        GatewayAuthentication authentication = getAuthentication();
        String appIdStr = (authentication != null) ? authentication.getAppId() : null;

        if (appIdStr == null) {
            // Anonymous requests are not subject to quota enforcement
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        UUID appId;
        try {
            appId = UUID.fromString(appIdStr);
        } catch (IllegalArgumentException e) {
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        // Reset counters if the month has rolled over
        YearMonth now = YearMonth.now();
        if (!now.equals(currentMonth)) {
            log.info("Month rolled over from {} to {} — clearing quota counters", currentMonth, now);
            currentMonth = now;
            usageCounters.clear();
        }

        long monthlyQuota = plan.getMaxRequestsPerMonth();
        AtomicLong counter = usageCounters.computeIfAbsent(appId, k -> new AtomicLong(0));
        long currentUsage = counter.incrementAndGet();

        if (currentUsage > monthlyQuota) {
            if ("STRICT".equals(plan.getEnforcement())) {
                log.debug("Monthly quota exceeded (STRICT): appId={}, usage={}, quota={}",
                        appId, currentUsage, monthlyQuota);
                writeErrorResponse(response, request);
                return;
            } else {
                // SOFT enforcement — log warning but allow through
                log.warn("Monthly quota exceeded (SOFT): appId={}, usage={}, quota={} — allowing request",
                        appId, currentUsage, monthlyQuota);
            }
        }

        // Set quota headers for visibility
        response.setHeader("X-Quota-Limit", String.valueOf(monthlyQuota));
        response.setHeader("X-Quota-Used", String.valueOf(currentUsage));
        response.setHeader("X-Quota-Remaining", String.valueOf(Math.max(0, monthlyQuota - currentUsage)));

        filterChain.doFilter(servletRequest, servletResponse);
    }

    /**
     * Periodically synchronises the in-memory counters with the actual counts
     * from the {@code analytics.request_logs} table. Runs every 5 minutes.
     *
     * <p>This ensures that counters stay reasonably accurate across gateway
     * restarts and multi-node deployments.</p>
     */
    @Scheduled(fixedDelay = 300_000, initialDelay = 60_000)
    public void syncCountersFromDatabase() {
        YearMonth month = YearMonth.now();

        // Reset if the month changed
        if (!month.equals(currentMonth)) {
            log.info("Month rolled over during sync from {} to {} — clearing quota counters", currentMonth, month);
            currentMonth = month;
            usageCounters.clear();
            return;
        }

        LocalDate monthStart = month.atDay(1);
        LocalDate nextMonthStart = month.plusMonths(1).atDay(1);

        String sql = """
                SELECT consumer_id, COUNT(*) as request_count
                FROM analytics.request_logs
                WHERE created_at >= CAST(? AS timestamptz) AND created_at < CAST(? AS timestamptz)
                  AND consumer_id IS NOT NULL
                  AND (mock_mode IS NULL OR mock_mode = false)
                GROUP BY consumer_id
                """;

        try {
            Map<UUID, Long> dbCounts = new ConcurrentHashMap<>();
            jdbcTemplate.query(sql, (rs, rowNum) -> {
                String consumerId = rs.getString("consumer_id");
                long count = rs.getLong("request_count");
                try {
                    dbCounts.put(UUID.fromString(consumerId), count);
                } catch (IllegalArgumentException e) {
                    // Skip non-UUID consumer IDs
                }
                return null;
            }, monthStart.toString(), nextMonthStart.toString());

            // Update in-memory counters with database values
            for (Map.Entry<UUID, Long> entry : dbCounts.entrySet()) {
                usageCounters.computeIfAbsent(entry.getKey(), k -> new AtomicLong(0))
                        .set(entry.getValue());
            }

            log.debug("Quota counters synced from database: {} applications updated", dbCounts.size());
        } catch (Exception e) {
            log.warn("Failed to sync quota counters from database: {}", e.getMessage());
        }
    }

    private void writeErrorResponse(HttpServletResponse response, HttpServletRequest request)
            throws IOException {
        ApiErrorResponse error = ApiErrorResponse.builder()
                .status(429)
                .error("QUOTA_EXCEEDED")
                .errorCode("GW_429_QUOTA")
                .message("Monthly API quota exceeded")
                .path(request.getRequestURI())
                .build();
        response.setStatus(429);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), error);
    }

    private GatewayAuthentication getAuthentication() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof GatewayAuthentication gatewayAuth) {
            return gatewayAuth;
        }
        return null;
    }

    /**
     * Returns an unmodifiable view of the current usage counters.
     * Useful for management/debug endpoints.
     */
    public Map<UUID, AtomicLong> getUsageCounters() {
        return Map.copyOf(usageCounters);
    }
}

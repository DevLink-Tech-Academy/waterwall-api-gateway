package com.gateway.management.service;

import com.gateway.common.auth.SecurityContextHelper;
import com.gateway.management.dto.ApiUsageBreakdownResponse;
import com.gateway.management.dto.CostEstimateResponse;
import com.gateway.management.dto.UsageHistoryResponse;
import com.gateway.management.dto.UsageSummaryResponse;
import com.gateway.management.entity.PlanEntity;
import com.gateway.management.entity.SubscriptionEntity;
import com.gateway.management.entity.enums.SubStatus;
import com.gateway.management.repository.PlanRepository;
import com.gateway.management.repository.SubscriptionRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConsumerUsageService {

    private final EntityManager entityManager;
    private final SubscriptionRepository subscriptionRepository;
    private final PlanRepository planRepository;

    // ── Usage Summary ─────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public UsageSummaryResponse getUsageSummary() {
        List<UUID> consumerIds = resolveAllConsumerIds();
        UUID consumerId = consumerIds.get(0); // primary user ID for subscription lookup

        LocalDate today = LocalDate.now();
        LocalDate weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate monthStart = today.withDayOfMonth(1);

        long requestsToday = countRequestsMulti(consumerIds, today, today);
        long requestsThisWeek = countRequestsMulti(consumerIds, weekStart, today);
        long requestsThisMonth = countRequestsMulti(consumerIds, monthStart, today);

        double avgLatency = queryAverageLatencyMulti(consumerIds, monthStart, today);
        double errorRate = queryErrorRateMulti(consumerIds, monthStart, today);

        // Check subscriptions for all app IDs
        long activeSubs = consumerIds.stream()
                .flatMap(id -> subscriptionRepository.findByApplicationId(id).stream())
                .filter(s -> s.getStatus() == SubStatus.APPROVED || s.getStatus() == SubStatus.ACTIVE)
                .count();

        List<UsageSummaryResponse.TopApiEntry> topApis = queryTopApisMulti(consumerIds, monthStart, today, 5);

        return UsageSummaryResponse.builder()
                .requestsToday(requestsToday)
                .requestsThisWeek(requestsThisWeek)
                .requestsThisMonth(requestsThisMonth)
                .averageLatencyMs(avgLatency)
                .errorRate(errorRate)
                .activeSubscriptions((int) activeSubs)
                .topApis(topApis)
                .build();
    }

    // ── Usage History ─────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public UsageHistoryResponse getUsageHistory(String range) {
        List<UUID> consumerIds = resolveAllConsumerIds();

        int days = parseDays(range);
        LocalDate endDate = LocalDate.now();
        LocalDate startDate = endDate.minusDays(days - 1);

        List<UsageHistoryResponse.DailyUsage> data = queryDailyUsageMulti(consumerIds, startDate, endDate);

        return UsageHistoryResponse.builder()
                .range(range)
                .data(data)
                .build();
    }

    // ── Per-API Breakdown ─────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public ApiUsageBreakdownResponse getApiBreakdown() {
        List<UUID> consumerIds = resolveAllConsumerIds();

        LocalDate monthStart = LocalDate.now().withDayOfMonth(1);
        LocalDate today = LocalDate.now();

        List<ApiUsageBreakdownResponse.ApiUsageEntry> entries = queryApiBreakdownMulti(consumerIds, monthStart, today);

        return ApiUsageBreakdownResponse.builder()
                .apis(entries)
                .build();
    }

    // ── Cost Estimate ─────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public CostEstimateResponse getCostEstimate() {
        List<UUID> consumerIds = resolveAllConsumerIds();

        LocalDate monthStart = LocalDate.now().withDayOfMonth(1);
        LocalDate monthEnd = LocalDate.now().with(TemporalAdjusters.lastDayOfMonth());
        LocalDate today = LocalDate.now();

        long totalRequests = countRequestsMulti(consumerIds, monthStart, today);

        // Resolve plan from any of the consumer's app IDs
        PlanEntity plan = null;
        for (UUID id : consumerIds) {
            plan = resolvePricingPlan(id);
            if (plan != null) break;
        }

        String planName = "None";
        String pricingModel = "FREE";
        String currency = "NGN";
        long includedRequests = 0;
        long overageRequests = 0;
        BigDecimal estimatedCost = BigDecimal.ZERO;

        if (plan != null) {
            planName = plan.getName();
            pricingModel = plan.getPricingModel() != null ? plan.getPricingModel() : "FREE";
            currency = plan.getCurrency() != null ? plan.getCurrency() : "NGN";
            includedRequests = plan.getIncludedRequests() != null ? plan.getIncludedRequests() : 0L;
            overageRequests = Math.max(0, totalRequests - includedRequests);
            estimatedCost = calculateCost(plan, totalRequests);
        }

        return CostEstimateResponse.builder()
                .billingPeriodStart(monthStart)
                .billingPeriodEnd(monthEnd)
                .totalRequests(totalRequests)
                .includedRequests(includedRequests)
                .overageRequests(overageRequests)
                .estimatedCost(estimatedCost)
                .currency(currency)
                .pricingModel(pricingModel)
                .planName(planName)
                .build();
    }

    // ── Private Helpers ───────────────────────────────────────────────────

    /**
     * Extracts the consumer ID from the JWT subject stored in the SecurityContext.
     */
    private UUID resolveConsumerId() {
        String userId = SecurityContextHelper.getCurrentUserId();
        if (userId == null) {
            throw new IllegalStateException("No authenticated consumer found in security context");
        }
        return UUID.fromString(userId);
    }

    /**
     * Resolve all consumer IDs that should be used for usage queries.
     * This includes the user ID itself AND all their application IDs,
     * since API key auth logs the application ID as consumer_id.
     */
    private List<UUID> resolveAllConsumerIds() {
        UUID userId = resolveConsumerId();
        List<UUID> ids = new ArrayList<>();
        ids.add(userId);

        // Also include the user's application IDs
        try {
            @SuppressWarnings("unchecked")
            List<Object> appIds = entityManager.createNativeQuery(
                    "SELECT id FROM identity.applications WHERE user_id = :userId AND status != 'DELETED'"
            ).setParameter("userId", userId).getResultList();

            for (Object appId : appIds) {
                if (appId instanceof UUID uuid) ids.add(uuid);
                else ids.add(UUID.fromString(appId.toString()));
            }
        } catch (Exception e) {
            log.warn("Failed to resolve application IDs for user {}: {}", userId, e.getMessage());
        }
        return ids;
    }

    private int parseDays(String range) {
        if (range == null || range.isBlank()) {
            return 7;
        }
        // Supports formats like "7d", "30d", "90d"
        String trimmed = range.trim().toLowerCase();
        if (trimmed.endsWith("d")) {
            try {
                int days = Integer.parseInt(trimmed.substring(0, trimmed.length() - 1));
                return Math.min(Math.max(days, 1), 365);
            } catch (NumberFormatException e) {
                log.warn("Invalid range format '{}'; defaulting to 7d", range);
                return 7;
            }
        }
        return 7;
    }

    // ── Multi-ID query methods (user ID + application IDs) ───────────────

    private long countRequestsMulti(List<UUID> consumerIds, LocalDate from, LocalDate to) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT COUNT(*) FROM analytics.request_logs " +
                    "WHERE CAST(consumer_id AS text) IN (:ids) AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= CAST(:from AS timestamp) AND created_at < CAST(:to AS timestamp) + INTERVAL '1 day'"
            );
            query.setParameter("ids", consumerIds.stream().map(UUID::toString).toList());
            query.setParameter("from", from.toString());
            query.setParameter("to", to.toString());
            return ((Number) query.getSingleResult()).longValue();
        } catch (Exception e) {
            log.warn("Failed to count requests: {}", e.getMessage());
            return 0;
        }
    }

    private double queryAverageLatencyMulti(List<UUID> consumerIds, LocalDate from, LocalDate to) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT COALESCE(AVG(latency_ms), 0) FROM analytics.request_logs " +
                    "WHERE CAST(consumer_id AS text) IN (:ids) AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= CAST(:from AS timestamp) AND created_at < CAST(:to AS timestamp) + INTERVAL '1 day'"
            );
            query.setParameter("ids", consumerIds.stream().map(UUID::toString).toList());
            query.setParameter("from", from.toString());
            query.setParameter("to", to.toString());
            return ((Number) query.getSingleResult()).doubleValue();
        } catch (Exception e) {
            log.warn("Failed to query avg latency: {}", e.getMessage());
            return 0;
        }
    }

    private double queryErrorRateMulti(List<UUID> consumerIds, LocalDate from, LocalDate to) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE " +
                    "ROUND(100.0 * SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) / COUNT(*), 2) END " +
                    "FROM analytics.request_logs " +
                    "WHERE CAST(consumer_id AS text) IN (:ids) AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= CAST(:from AS timestamp) AND created_at < CAST(:to AS timestamp) + INTERVAL '1 day'"
            );
            query.setParameter("ids", consumerIds.stream().map(UUID::toString).toList());
            query.setParameter("from", from.toString());
            query.setParameter("to", to.toString());
            return ((Number) query.getSingleResult()).doubleValue();
        } catch (Exception e) {
            log.warn("Failed to query error rate: {}", e.getMessage());
            return 0;
        }
    }

    private List<UsageSummaryResponse.TopApiEntry> queryTopApisMulti(List<UUID> consumerIds, LocalDate from, LocalDate to, int limit) {
        try {
            @SuppressWarnings("unchecked")
            List<Object[]> rows = entityManager.createNativeQuery(
                    "SELECT rl.api_id, COALESCE(a.name, CAST(rl.api_id AS text)), COUNT(*) as cnt " +
                    "FROM analytics.request_logs rl " +
                    "LEFT JOIN gateway.apis a ON a.id = rl.api_id " +
                    "WHERE CAST(rl.consumer_id AS text) IN (:ids) " +
                    "AND rl.api_id IS NOT NULL " +
                    "AND rl.created_at >= CAST(:from AS timestamp) AND rl.created_at < CAST(:to AS timestamp) + INTERVAL '1 day' " +
                    "GROUP BY rl.api_id, a.name ORDER BY cnt DESC LIMIT :lim"
            ).setParameter("ids", consumerIds.stream().map(UUID::toString).toList())
             .setParameter("from", from.toString())
             .setParameter("to", to.toString())
             .setParameter("lim", limit)
             .getResultList();

            List<UsageSummaryResponse.TopApiEntry> result = new ArrayList<>();
            for (Object[] row : rows) {
                result.add(UsageSummaryResponse.TopApiEntry.builder()
                        .apiId(row[0] != null ? row[0].toString() : null)
                        .apiName(row[1] != null ? row[1].toString() : "Unknown")
                        .requestCount(((Number) row[2]).longValue())
                        .build());
            }
            return result;
        } catch (Exception e) {
            log.warn("Failed to query top APIs: {}", e.getMessage());
            return List.of();
        }
    }

    private List<UsageHistoryResponse.DailyUsage> queryDailyUsageMulti(List<UUID> consumerIds, LocalDate from, LocalDate to) {
        try {
            @SuppressWarnings("unchecked")
            List<Object[]> rows = entityManager.createNativeQuery(
                    "SELECT CAST(created_at AS date) as day, COUNT(*) as cnt, " +
                    "SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors, " +
                    "COALESCE(AVG(latency_ms), 0) as avg_lat " +
                    "FROM analytics.request_logs " +
                    "WHERE CAST(consumer_id AS text) IN (:ids) AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= CAST(:from AS timestamp) AND created_at < CAST(:to AS timestamp) + INTERVAL '1 day' " +
                    "GROUP BY CAST(created_at AS date) ORDER BY day"
            ).setParameter("ids", consumerIds.stream().map(UUID::toString).toList())
             .setParameter("from", from.toString())
             .setParameter("to", to.toString())
             .getResultList();

            List<UsageHistoryResponse.DailyUsage> result = new ArrayList<>();
            for (Object[] row : rows) {
                result.add(UsageHistoryResponse.DailyUsage.builder()
                        .date(row[0] != null ? LocalDate.parse(row[0].toString()) : LocalDate.now())
                        .requestCount(((Number) row[1]).longValue())
                        .errorCount(((Number) row[2]).longValue())
                        .averageLatencyMs(((Number) row[3]).doubleValue())
                        .build());
            }
            return result;
        } catch (Exception e) {
            log.warn("Failed to query daily usage: {}", e.getMessage());
            return List.of();
        }
    }

    private List<ApiUsageBreakdownResponse.ApiUsageEntry> queryApiBreakdownMulti(List<UUID> consumerIds, LocalDate from, LocalDate to) {
        try {
            @SuppressWarnings("unchecked")
            List<Object[]> rows = entityManager.createNativeQuery(
                    "SELECT rl.api_id, COALESCE(a.name, CAST(rl.api_id AS text)), COUNT(*), " +
                    "COALESCE(AVG(rl.latency_ms), 0), " +
                    "SUM(CASE WHEN rl.status_code >= 400 THEN 1 ELSE 0 END) " +
                    "FROM analytics.request_logs rl " +
                    "LEFT JOIN gateway.apis a ON a.id = rl.api_id " +
                    "WHERE CAST(rl.consumer_id AS text) IN (:ids) " +
                    "AND rl.api_id IS NOT NULL " +
                    "AND rl.created_at >= CAST(:from AS timestamp) AND rl.created_at < CAST(:to AS timestamp) + INTERVAL '1 day' " +
                    "GROUP BY rl.api_id, a.name ORDER BY COUNT(*) DESC"
            ).setParameter("ids", consumerIds.stream().map(UUID::toString).toList())
             .setParameter("from", from.toString())
             .setParameter("to", to.toString())
             .getResultList();

            List<ApiUsageBreakdownResponse.ApiUsageEntry> result = new ArrayList<>();
            for (Object[] row : rows) {
                long total = ((Number) row[2]).longValue();
                long errors = ((Number) row[4]).longValue();
                result.add(ApiUsageBreakdownResponse.ApiUsageEntry.builder()
                        .apiId(row[0] != null ? row[0].toString() : null)
                        .apiName(row[1] != null ? row[1].toString() : "Unknown")
                        .totalRequests(total)
                        .averageLatencyMs(((Number) row[3]).doubleValue())
                        .errorCount(errors)
                        .errorRate(total > 0 ? Math.round(10000.0 * errors / total) / 100.0 : 0)
                        .build());
            }
            return result;
        } catch (Exception e) {
            log.warn("Failed to query API breakdown: {}", e.getMessage());
            return List.of();
        }
    }

    // ── Original single-ID query methods (kept for backward compat) ──────

    private long countRequests(UUID consumerId, LocalDate from, LocalDate to) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT COUNT(*) FROM analytics.request_logs " +
                    "WHERE consumer_id = :consumerId AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= :start " +
                    "AND created_at < :endExclusive"
            );
            query.setParameter("consumerId", consumerId);
            query.setParameter("start", from.atStartOfDay());
            query.setParameter("endExclusive", to.plusDays(1).atStartOfDay());
            Number result = (Number) query.getSingleResult();
            return result != null ? result.longValue() : 0L;
        } catch (Exception e) {
            log.warn("Failed to count requests for consumer={}: {}", consumerId, e.getMessage());
            return 0L;
        }
    }

    private double queryAverageLatency(UUID consumerId, LocalDate from, LocalDate to) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT COALESCE(AVG(latency_ms), 0) FROM analytics.request_logs " +
                    "WHERE consumer_id = :consumerId AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= :start " +
                    "AND created_at < :endExclusive"
            );
            query.setParameter("consumerId", consumerId);
            query.setParameter("start", from.atStartOfDay());
            query.setParameter("endExclusive", to.plusDays(1).atStartOfDay());
            Number result = (Number) query.getSingleResult();
            return result != null ? Math.round(result.doubleValue() * 100.0) / 100.0 : 0.0;
        } catch (Exception e) {
            log.warn("Failed to query average latency for consumer={}: {}", consumerId, e.getMessage());
            return 0.0;
        }
    }

    private double queryErrorRate(UUID consumerId, LocalDate from, LocalDate to) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT " +
                    "  COUNT(*) FILTER (WHERE status_code >= 400) AS error_count, " +
                    "  COUNT(*) AS total_count " +
                    "FROM analytics.request_logs " +
                    "WHERE consumer_id = :consumerId AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= :start " +
                    "AND created_at < :endExclusive"
            );
            query.setParameter("consumerId", consumerId);
            query.setParameter("start", from.atStartOfDay());
            query.setParameter("endExclusive", to.plusDays(1).atStartOfDay());
            Object[] row = (Object[]) query.getSingleResult();
            long errorCount = ((Number) row[0]).longValue();
            long totalCount = ((Number) row[1]).longValue();
            if (totalCount == 0) return 0.0;
            return Math.round((double) errorCount / totalCount * 10000.0) / 100.0;
        } catch (Exception e) {
            log.warn("Failed to query error rate for consumer={}: {}", consumerId, e.getMessage());
            return 0.0;
        }
    }

    @SuppressWarnings("unchecked")
    private List<UsageSummaryResponse.TopApiEntry> queryTopApis(UUID consumerId, LocalDate from, LocalDate to, int limit) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT rl.api_id, COALESCE(a.name, rl.api_id::text) AS api_name, COUNT(*) AS req_count " +
                    "FROM analytics.request_logs rl " +
                    "LEFT JOIN gateway.apis a ON a.id = rl.api_id " +
                    "WHERE rl.consumer_id = :consumerId " +
                    "AND rl.created_at >= :start " +
                    "AND rl.created_at < :endExclusive " +
                    "GROUP BY rl.api_id, a.name " +
                    "ORDER BY req_count DESC " +
                    "LIMIT :limit"
            );
            query.setParameter("consumerId", consumerId);
            query.setParameter("start", from.atStartOfDay());
            query.setParameter("endExclusive", to.plusDays(1).atStartOfDay());
            query.setParameter("limit", limit);

            List<Object[]> rows = query.getResultList();
            List<UsageSummaryResponse.TopApiEntry> entries = new ArrayList<>();
            for (Object[] row : rows) {
                entries.add(UsageSummaryResponse.TopApiEntry.builder()
                        .apiId(row[0].toString())
                        .apiName((String) row[1])
                        .requestCount(((Number) row[2]).longValue())
                        .build());
            }
            return entries;
        } catch (Exception e) {
            log.warn("Failed to query top APIs for consumer={}: {}", consumerId, e.getMessage());
            return List.of();
        }
    }

    @SuppressWarnings("unchecked")
    private List<UsageHistoryResponse.DailyUsage> queryDailyUsage(UUID consumerId, LocalDate from, LocalDate to) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT " +
                    "  DATE(created_at) AS day, " +
                    "  COUNT(*) AS req_count, " +
                    "  COUNT(*) FILTER (WHERE status_code >= 400) AS err_count, " +
                    "  COALESCE(AVG(latency_ms), 0) AS avg_latency " +
                    "FROM analytics.request_logs " +
                    "WHERE consumer_id = :consumerId AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= :start " +
                    "AND created_at < :endExclusive " +
                    "GROUP BY DATE(created_at) " +
                    "ORDER BY day ASC"
            );
            query.setParameter("consumerId", consumerId);
            query.setParameter("start", from.atStartOfDay());
            query.setParameter("endExclusive", to.plusDays(1).atStartOfDay());

            List<Object[]> rows = query.getResultList();
            List<UsageHistoryResponse.DailyUsage> data = new ArrayList<>();
            for (Object[] row : rows) {
                data.add(UsageHistoryResponse.DailyUsage.builder()
                        .date(((java.sql.Date) row[0]).toLocalDate())
                        .requestCount(((Number) row[1]).longValue())
                        .errorCount(((Number) row[2]).longValue())
                        .averageLatencyMs(Math.round(((Number) row[3]).doubleValue() * 100.0) / 100.0)
                        .build());
            }
            return data;
        } catch (Exception e) {
            log.warn("Failed to query daily usage for consumer={}: {}", consumerId, e.getMessage());
            return List.of();
        }
    }

    @SuppressWarnings("unchecked")
    private List<ApiUsageBreakdownResponse.ApiUsageEntry> queryApiBreakdown(UUID consumerId, LocalDate from, LocalDate to) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT " +
                    "  rl.api_id, " +
                    "  COALESCE(a.name, rl.api_id::text) AS api_name, " +
                    "  COUNT(*) AS total_req, " +
                    "  COALESCE(AVG(rl.latency_ms), 0) AS avg_latency, " +
                    "  COUNT(*) FILTER (WHERE rl.status_code >= 400) AS err_count " +
                    "FROM analytics.request_logs rl " +
                    "LEFT JOIN gateway.apis a ON a.id = rl.api_id " +
                    "WHERE rl.consumer_id = :consumerId " +
                    "AND rl.created_at >= :start " +
                    "AND rl.created_at < :endExclusive " +
                    "GROUP BY rl.api_id, a.name " +
                    "ORDER BY total_req DESC"
            );
            query.setParameter("consumerId", consumerId);
            query.setParameter("start", from.atStartOfDay());
            query.setParameter("endExclusive", to.plusDays(1).atStartOfDay());

            List<Object[]> rows = query.getResultList();
            List<ApiUsageBreakdownResponse.ApiUsageEntry> entries = new ArrayList<>();
            for (Object[] row : rows) {
                long totalReq = ((Number) row[2]).longValue();
                long errCount = ((Number) row[4]).longValue();
                double errRate = totalReq > 0
                        ? Math.round((double) errCount / totalReq * 10000.0) / 100.0
                        : 0.0;

                entries.add(ApiUsageBreakdownResponse.ApiUsageEntry.builder()
                        .apiId(row[0].toString())
                        .apiName((String) row[1])
                        .totalRequests(totalReq)
                        .averageLatencyMs(Math.round(((Number) row[3]).doubleValue() * 100.0) / 100.0)
                        .errorCount(errCount)
                        .errorRate(errRate)
                        .build());
            }
            return entries;
        } catch (Exception e) {
            log.warn("Failed to query API breakdown for consumer={}: {}", consumerId, e.getMessage());
            return List.of();
        }
    }

    /**
     * Resolves the pricing plan for a consumer by looking at their active subscription
     * in gateway.plans (which now contains pricing columns).
     * Falls back to the first available plan if no subscription is found.
     */
    private PlanEntity resolvePricingPlan(UUID consumerId) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT p.* FROM gateway.plans p " +
                    "JOIN gateway.subscriptions s ON s.plan_id = p.id " +
                    "WHERE s.application_id = :consumerId " +
                    "AND s.status = 'APPROVED' " +
                    "ORDER BY s.created_at DESC LIMIT 1",
                    PlanEntity.class
            );
            query.setParameter("consumerId", consumerId);
            List<?> results = query.getResultList();
            if (!results.isEmpty()) {
                return (PlanEntity) results.get(0);
            }
        } catch (Exception e) {
            log.debug("No subscription-linked plan found for consumer={}: {}", consumerId, e.getMessage());
        }

        List<PlanEntity> plans = planRepository.findAll();
        if (!plans.isEmpty()) {
            return plans.get(0);
        }
        return null;
    }

    private BigDecimal calculateCost(PlanEntity plan, long requestCount) {
        return PricingCalculator.calculateCost(plan, requestCount);
    }
}

package com.gateway.management.service;

import com.gateway.management.entity.PlanEntity;
import com.gateway.management.entity.SubscriptionEntity;
import com.gateway.management.entity.enums.SubStatus;
import com.gateway.management.repository.SubscriptionRepository;
import com.gateway.management.repository.WalletRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class WalletDeductionScheduler {

    private final PlatformSettingsService platformSettingsService;
    private final SubscriptionRepository subscriptionRepository;
    private final WalletRepository walletRepository;
    private final WalletService walletService;
    private final EntityManager entityManager;

    private volatile Instant lastRunTime = null;

    private static final int DEFAULT_INTERVAL_MINUTES = 5;

    /**
     * Runs every minute but only processes if enough time has passed
     * based on the admin-configured interval. This allows dynamic interval
     * changes without restart.
     */
    @Scheduled(fixedDelay = 60_000, initialDelay = 120_000)
    @Transactional
    public void deductUsage() {
        if (!platformSettingsService.isPayAsYouGoMode()) {
            return;
        }

        int intervalMinutes = platformSettingsService.getWalletDeductionIntervalMinutes();
        if (intervalMinutes <= 0) intervalMinutes = DEFAULT_INTERVAL_MINUTES;

        Instant now = Instant.now();

        // Skip if not enough time has passed since last run
        if (lastRunTime != null) {
            long minutesSinceLastRun = ChronoUnit.MINUTES.between(lastRunTime, now);
            if (minutesSinceLastRun < intervalMinutes) {
                return;
            }
        }

        Instant since = lastRunTime != null ? lastRunTime : now.minus(intervalMinutes, ChronoUnit.MINUTES);
        lastRunTime = now;

        log.debug("Wallet deduction running: window {} to {} (interval={}min)", since, now, intervalMinutes);

        List<SubscriptionEntity> subscriptions = subscriptionRepository.findByStatus(SubStatus.APPROVED);

        // Group subscriptions by app ID
        Map<UUID, List<SubscriptionEntity>> byAppId = new HashMap<>();
        for (SubscriptionEntity sub : subscriptions) {
            byAppId.computeIfAbsent(sub.getApplicationId(), k -> new ArrayList<>()).add(sub);
        }

        // Build app ID -> user ID mapping
        Map<UUID, UUID> appToUser = resolveAppOwners(byAppId.keySet());

        int deducted = 0;
        for (Map.Entry<UUID, List<SubscriptionEntity>> entry : byAppId.entrySet()) {
            UUID appId = entry.getKey();
            List<SubscriptionEntity> consumerSubs = entry.getValue();

            // Resolve the wallet owner (user who owns this app)
            UUID walletOwnerId = appToUser.getOrDefault(appId, appId);

            try {
                // Count requests for this app ID (that's what gets logged)
                long requestCount = countRequests(appId, since, now);
                if (requestCount == 0) continue;

                // Resolve the plan for cost calculation
                PlanEntity plan = resolvePlan(consumerSubs);
                if (plan == null) continue;

                String model = plan.getPricingModel() != null ? plan.getPricingModel().toUpperCase() : "FREE";

                // FREE plans never charge
                if ("FREE".equals(model)) continue;

                // FLAT_RATE in PAY_AS_YOU_GO doesn't make sense — skip
                // (flat rate is a subscription concept, not per-request)
                if ("FLAT_RATE".equals(model)) continue;

                // For PAY_PER_USE, TIERED, FREEMIUM — calculate cost using PricingCalculator
                // But we need incremental cost (just this window's requests), not total month
                long monthlyUsage = countMonthlyRequests(appId);
                long usageBefore = monthlyUsage - requestCount;

                // Calculate cost for total monthly usage vs cost before this window
                // The difference is what this window costs
                BigDecimal costTotal = PricingCalculator.calculateCost(plan, monthlyUsage);
                BigDecimal costBefore = PricingCalculator.calculateCost(plan, usageBefore);

                // For TIERED model, subtract the base fee from both since it's a subscription charge
                if ("TIERED".equals(model)) {
                    BigDecimal baseFee = plan.getPriceAmount() != null ? plan.getPriceAmount() : BigDecimal.ZERO;
                    costTotal = costTotal.subtract(baseFee);
                    costBefore = costBefore.subtract(baseFee);
                }

                BigDecimal cost = costTotal.subtract(costBefore).max(BigDecimal.ZERO)
                        .setScale(2, RoundingMode.HALF_UP);

                if (cost.signum() <= 0) continue;

                BigDecimal perRequestRate = plan.getOverageRate() != null ? plan.getOverageRate() : BigDecimal.ZERO;
                long billableRequests = perRequestRate.signum() > 0
                        ? cost.divide(perRequestRate, 0, RoundingMode.HALF_UP).longValue()
                        : requestCount;

                // Deduct from the user's wallet, not the app's
                walletService.deduct(walletOwnerId, cost,
                        "USAGE-" + now.toEpochMilli(),
                        billableRequests + " API requests @ " + perRequestRate + "/req (" + model + ")",
                        null);
                deducted++;

            } catch (IllegalStateException e) {
                log.warn("Wallet deduction failed for consumer={}: {}", consumerId, e.getMessage());
            } catch (Exception e) {
                log.error("Wallet deduction error for consumer={}: {}", consumerId, e.getMessage());
            }
        }

        if (deducted > 0) {
            log.info("Wallet deduction complete: {} consumers charged", deducted);
        }
    }

    private long countRequests(UUID consumerId, Instant since, Instant until) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT COUNT(*) FROM analytics.request_logs " +
                    "WHERE consumer_id = :consumerId " +
                    "AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= :since AND created_at < :until"
            );
            query.setParameter("consumerId", consumerId);
            query.setParameter("since", java.sql.Timestamp.from(since));
            query.setParameter("until", java.sql.Timestamp.from(until));
            return ((Number) query.getSingleResult()).longValue();
        } catch (Exception e) {
            log.warn("Failed to count requests for consumer={}: {}", consumerId, e.getMessage());
            return 0;
        }
    }

    private long countMonthlyRequests(UUID consumerId) {
        try {
            java.time.LocalDate monthStart = java.time.LocalDate.now().withDayOfMonth(1);
            Query query = entityManager.createNativeQuery(
                    "SELECT COUNT(*) FROM analytics.request_logs " +
                    "WHERE consumer_id = :consumerId " +
                    "AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= CAST(:monthStart AS timestamp)"
            );
            query.setParameter("consumerId", consumerId);
            query.setParameter("monthStart", monthStart.toString());
            return ((Number) query.getSingleResult()).longValue();
        } catch (Exception e) {
            return 0;
        }
    }

    private PlanEntity resolvePlan(List<SubscriptionEntity> subs) {
        // Prefer a plan with an overage rate set (i.e. a paid plan)
        for (SubscriptionEntity sub : subs) {
            PlanEntity plan = sub.getPlan();
            if (plan != null && plan.getOverageRate() != null && plan.getOverageRate().signum() > 0) {
                return plan;
            }
        }
        // Fall back to any non-free plan
        for (SubscriptionEntity sub : subs) {
            PlanEntity plan = sub.getPlan();
            if (plan != null && !"FREE".equalsIgnoreCase(plan.getPricingModel())) {
                return plan;
            }
        }
        // Last resort: any plan
        for (SubscriptionEntity sub : subs) {
            if (sub.getPlan() != null) return sub.getPlan();
        }
        return null;
    }

    /**
     * Maps application IDs to the user IDs that own them.
     * Wallets are keyed by user ID, but request logs use app ID as consumer_id.
     */
    @SuppressWarnings("unchecked")
    private Map<UUID, UUID> resolveAppOwners(java.util.Set<UUID> appIds) {
        Map<UUID, UUID> mapping = new HashMap<>();
        if (appIds.isEmpty()) return mapping;

        try {
            List<Object[]> rows = entityManager.createNativeQuery(
                    "SELECT id, user_id FROM identity.applications WHERE id IN (:appIds)"
            ).setParameter("appIds", new ArrayList<>(appIds)).getResultList();

            for (Object[] row : rows) {
                UUID appId = (UUID) row[0];
                UUID userId = (UUID) row[1];
                if (userId != null) {
                    mapping.put(appId, userId);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to resolve app owners: {}", e.getMessage());
        }
        return mapping;
    }
}

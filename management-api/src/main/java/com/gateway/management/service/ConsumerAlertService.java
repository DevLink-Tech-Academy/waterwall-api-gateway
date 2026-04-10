package com.gateway.management.service;

import com.gateway.common.auth.SecurityContextHelper;
import com.gateway.common.events.EventPublisher;
import com.gateway.common.events.RabbitMQExchanges;
import com.gateway.management.entity.ConsumerAlertRuleEntity;
import com.gateway.management.repository.ConsumerAlertRuleRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import jakarta.persistence.Query;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Manages consumer alert rules: CRUD operations and rule evaluation
 * against current usage metrics (quota usage, monthly cost, error rate, latency p95).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ConsumerAlertService {

    private final ConsumerAlertRuleRepository consumerAlertRuleRepository;
    private final EntityManager entityManager;
    private final EventPublisher eventPublisher;

    // ── CRUD Operations ──────────────────────────────────────────────────

    @Transactional
    public ConsumerAlertRuleEntity createRule(UUID userId, Map<String, String> request) {
        ConsumerAlertRuleEntity rule = ConsumerAlertRuleEntity.builder()
                .userId(userId)
                .metric(request.get("metric"))
                .condition(request.get("condition"))
                .threshold(new BigDecimal(request.get("threshold")))
                .enabled(request.containsKey("enabled") ? Boolean.parseBoolean(request.get("enabled")) : true)
                .build();

        ConsumerAlertRuleEntity saved = consumerAlertRuleRepository.save(rule);
        log.info("Consumer alert rule created: id={}, userId={}, metric={}, condition={}, threshold={}",
                saved.getId(), userId, saved.getMetric(), saved.getCondition(), saved.getThreshold());
        return saved;
    }

    @Transactional(readOnly = true)
    public List<ConsumerAlertRuleEntity> listRules(UUID userId) {
        return consumerAlertRuleRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    @Transactional
    public ConsumerAlertRuleEntity updateRule(UUID userId, UUID ruleId, Map<String, String> request) {
        ConsumerAlertRuleEntity rule = consumerAlertRuleRepository.findByIdAndUserId(ruleId, userId)
                .orElseThrow(() -> new EntityNotFoundException("Alert rule not found: " + ruleId));

        if (request.containsKey("metric")) {
            rule.setMetric(request.get("metric"));
        }
        if (request.containsKey("condition")) {
            rule.setCondition(request.get("condition"));
        }
        if (request.containsKey("threshold")) {
            rule.setThreshold(new BigDecimal(request.get("threshold")));
        }
        if (request.containsKey("enabled")) {
            rule.setEnabled(Boolean.parseBoolean(request.get("enabled")));
        }

        ConsumerAlertRuleEntity saved = consumerAlertRuleRepository.save(rule);
        log.info("Consumer alert rule updated: id={}, userId={}", ruleId, userId);
        return saved;
    }

    @Transactional
    public void deleteRule(UUID userId, UUID ruleId) {
        ConsumerAlertRuleEntity rule = consumerAlertRuleRepository.findByIdAndUserId(ruleId, userId)
                .orElseThrow(() -> new EntityNotFoundException("Alert rule not found: " + ruleId));

        consumerAlertRuleRepository.delete(rule);
        log.info("Consumer alert rule deleted: id={}, userId={}", ruleId, userId);
    }

    // ── Rule Evaluation ──────────────────────────────────────────────────

    /**
     * Evaluates all enabled alert rules against current metrics.
     * Can be called from a scheduler or on-demand.
     */
    @Scheduled(fixedDelay = 300_000, initialDelay = 120_000)
    @Transactional
    public void evaluateRules() {
        List<ConsumerAlertRuleEntity> enabledRules = consumerAlertRuleRepository.findByEnabledTrue();
        log.info("Evaluating {} enabled consumer alert rules", enabledRules.size());

        for (ConsumerAlertRuleEntity rule : enabledRules) {
            try {
                BigDecimal currentValue = fetchMetricValue(rule.getUserId(), rule.getMetric());
                if (currentValue == null) {
                    continue;
                }

                boolean triggered = evaluateCondition(currentValue, rule.getCondition(), rule.getThreshold());
                if (triggered) {
                    rule.setLastTriggeredAt(Instant.now());
                    consumerAlertRuleRepository.save(rule);
                    BillingSchedulerService.BillingEvent alertEvent =
                            BillingSchedulerService.BillingEvent.builder()
                                    .eventType("consumer.alert_triggered")
                                    .actorId("alert-scheduler")
                                    .consumerId(rule.getUserId().toString())
                                    .build();
                    eventPublisher.publish(RabbitMQExchanges.PLATFORM_EVENTS,
                            "consumer.alert_triggered", alertEvent);
                    log.warn("Alert rule triggered: id={}, userId={}, metric={}, current={}, condition={}, threshold={}",
                            rule.getId(), rule.getUserId(), rule.getMetric(),
                            currentValue, rule.getCondition(), rule.getThreshold());
                }
            } catch (Exception e) {
                log.error("Failed to evaluate alert rule id={}: {}", rule.getId(), e.getMessage());
            }
        }
    }

    // ── Private Helpers ──────────────────────────────────────────────────

    private UUID resolveConsumerId() {
        String userId = SecurityContextHelper.getCurrentUserId();
        if (userId == null) {
            throw new IllegalStateException("No authenticated consumer found in security context");
        }
        return UUID.fromString(userId);
    }

    /**
     * Fetches the current metric value for a given consumer and metric type.
     */
    private BigDecimal fetchMetricValue(UUID userId, String metric) {
        LocalDate monthStart = LocalDate.now().withDayOfMonth(1);
        LocalDate today = LocalDate.now();

        return switch (metric) {
            case "QUOTA_PERCENT" -> fetchQuotaPercent(userId, monthStart, today);
            case "MONTHLY_COST" -> fetchMonthlyCost(userId, monthStart, today);
            case "ERROR_RATE" -> fetchErrorRate(userId, monthStart, today);
            case "LATENCY_P95" -> fetchLatencyP95(userId, monthStart, today);
            default -> {
                log.warn("Unknown metric type: {}", metric);
                yield null;
            }
        };
    }

    private BigDecimal fetchQuotaPercent(UUID userId, LocalDate from, LocalDate to) {
        try {
            // Count requests for the current month
            Query countQuery = entityManager.createNativeQuery(
                    "SELECT COUNT(*) FROM analytics.request_logs " +
                    "WHERE consumer_id = :userId AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= CAST(:from AS timestamp) AND created_at < CAST(:to AS timestamp) + INTERVAL '1 day'"
            );
            countQuery.setParameter("userId", userId);
            countQuery.setParameter("from", from.toString());
            countQuery.setParameter("to", to.toString());
            long requestCount = ((Number) countQuery.getSingleResult()).longValue();

            // Look up the plan's included requests
            Query planQuery = entityManager.createNativeQuery(
                    "SELECT p.included_requests FROM gateway.plans p " +
                    "JOIN gateway.subscriptions s ON s.plan_id = p.id " +
                    "WHERE s.application_id = :userId AND s.status = 'APPROVED' " +
                    "ORDER BY s.created_at DESC LIMIT 1"
            );
            planQuery.setParameter("userId", userId);
            List<?> results = planQuery.getResultList();
            if (results.isEmpty() || results.get(0) == null) {
                return BigDecimal.ZERO;
            }
            long includedRequests = ((Number) results.get(0)).longValue();
            if (includedRequests == 0) {
                return BigDecimal.ZERO;
            }

            return BigDecimal.valueOf(requestCount)
                    .multiply(BigDecimal.valueOf(100))
                    .divide(BigDecimal.valueOf(includedRequests), 2, RoundingMode.HALF_UP);
        } catch (Exception e) {
            log.warn("Failed to fetch quota percent for userId={}: {}", userId, e.getMessage());
            return null;
        }
    }

    private BigDecimal fetchMonthlyCost(UUID userId, LocalDate from, LocalDate to) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT COALESCE(SUM(total_amount), 0) FROM gateway.invoices " +
                    "WHERE consumer_id = :userId " +
                    "AND billing_period_start >= CAST(:from AS date) " +
                    "AND billing_period_start <= CAST(:to AS date)"
            );
            query.setParameter("userId", userId);
            query.setParameter("from", from.toString());
            query.setParameter("to", to.toString());
            return new BigDecimal(query.getSingleResult().toString());
        } catch (Exception e) {
            log.warn("Failed to fetch monthly cost for userId={}: {}", userId, e.getMessage());
            return null;
        }
    }

    private BigDecimal fetchErrorRate(UUID userId, LocalDate from, LocalDate to) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE " +
                    "ROUND(100.0 * SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) / COUNT(*), 2) END " +
                    "FROM analytics.request_logs " +
                    "WHERE consumer_id = :userId AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= CAST(:from AS timestamp) AND created_at < CAST(:to AS timestamp) + INTERVAL '1 day'"
            );
            query.setParameter("userId", userId);
            query.setParameter("from", from.toString());
            query.setParameter("to", to.toString());
            return new BigDecimal(query.getSingleResult().toString());
        } catch (Exception e) {
            log.warn("Failed to fetch error rate for userId={}: {}", userId, e.getMessage());
            return null;
        }
    }

    private BigDecimal fetchLatencyP95(UUID userId, LocalDate from, LocalDate to) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 0) " +
                    "FROM analytics.request_logs " +
                    "WHERE consumer_id = :userId AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= CAST(:from AS timestamp) AND created_at < CAST(:to AS timestamp) + INTERVAL '1 day'"
            );
            query.setParameter("userId", userId);
            query.setParameter("from", from.toString());
            query.setParameter("to", to.toString());
            return new BigDecimal(query.getSingleResult().toString());
        } catch (Exception e) {
            log.warn("Failed to fetch latency p95 for userId={}: {}", userId, e.getMessage());
            return null;
        }
    }

    private boolean evaluateCondition(BigDecimal currentValue, String condition, BigDecimal threshold) {
        int cmp = currentValue.compareTo(threshold);
        return switch (condition) {
            case "GT" -> cmp > 0;
            case "GTE" -> cmp >= 0;
            case "LT" -> cmp < 0;
            case "LTE" -> cmp <= 0;
            default -> {
                log.warn("Unknown condition type: {}", condition);
                yield false;
            }
        };
    }
}

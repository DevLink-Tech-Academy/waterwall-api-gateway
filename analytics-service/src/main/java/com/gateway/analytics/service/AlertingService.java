package com.gateway.analytics.service;

import com.gateway.analytics.dto.AlertHistoryResponse;
import com.gateway.analytics.dto.AlertRuleRequest;
import com.gateway.analytics.dto.AlertRuleResponse;
import com.gateway.analytics.entity.AlertHistoryEntity;
import com.gateway.analytics.entity.AlertRuleEntity;
import com.gateway.analytics.repository.AlertHistoryRepository;
import com.gateway.analytics.repository.AlertRuleRepository;
import com.gateway.analytics.store.RequestLogStore;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Evaluates alert rules on a schedule and creates alert history entries
 * when thresholds are exceeded.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AlertingService {

    private final AlertRuleRepository alertRuleRepository;
    private final AlertHistoryRepository alertHistoryRepository;
    private final RequestLogStore requestLogStore;

    // ── Scheduled Evaluation ─────────────────────────────────────────────

    /**
     * Evaluate all enabled alert rules every 5 minutes.
     */
    @Scheduled(fixedRate = 300000)
    @Transactional
    public void evaluateAlertRules() {
        List<AlertRuleEntity> rules = alertRuleRepository.findByEnabledTrue();
        log.debug("Evaluating {} active alert rules", rules.size());

        for (AlertRuleEntity rule : rules) {
            try {
                evaluateRule(rule);
            } catch (Exception e) {
                log.error("Failed to evaluate alert rule {}: {}", rule.getId(), e.getMessage(), e);
            }
        }
    }

    private void evaluateRule(AlertRuleEntity rule) {
        BigDecimal currentValue = queryMetric(rule.getMetric(), rule.getWindowMinutes(), rule.getApiId());
        if (currentValue == null) {
            log.debug("No data for rule {} metric={}", rule.getId(), rule.getMetric());
            return;
        }

        boolean triggered = evaluateCondition(currentValue, rule.getCondition(), rule.getThreshold());

        if (triggered) {
            log.info("Alert triggered: rule={} metric={} value={} {} threshold={}",
                    rule.getName(), rule.getMetric(), currentValue, rule.getCondition(), rule.getThreshold());

            AlertHistoryEntity alert = AlertHistoryEntity.builder()
                    .rule(rule)
                    .status("TRIGGERED")
                    .value(currentValue)
                    .message(String.format("Alert '%s': %s is %s (threshold: %s %s)",
                            rule.getName(), rule.getMetric(), currentValue,
                            rule.getCondition(), rule.getThreshold()))
                    .build();
            alertHistoryRepository.save(alert);
        }
    }

    private BigDecimal queryMetric(String metric, int windowMinutes, UUID apiId) {
        return requestLogStore.queryMetric(metric, windowMinutes, apiId);
    }

    private boolean evaluateCondition(BigDecimal value, String condition, BigDecimal threshold) {
        return switch (condition.toUpperCase()) {
            case "GREATER_THAN", "GT" -> value.compareTo(threshold) > 0;
            case "LESS_THAN", "LT" -> value.compareTo(threshold) < 0;
            case "EQUALS", "EQ" -> value.compareTo(threshold) == 0;
            case "GTE" -> value.compareTo(threshold) >= 0;
            case "LTE" -> value.compareTo(threshold) <= 0;
            default -> {
                log.warn("Unknown condition: {}", condition);
                yield false;
            }
        };
    }

    // ── Alert Rule CRUD ──────────────────────────────────────────────────

    @Transactional
    public AlertRuleResponse createRule(AlertRuleRequest request) {
        AlertRuleEntity entity = AlertRuleEntity.builder()
                .name(request.getName())
                .metric(request.getMetric())
                .condition(request.getCondition())
                .threshold(request.getThreshold())
                .windowMinutes(request.getWindowMinutes())
                .apiId(request.getApiId())
                .enabled(request.isEnabled())
                .channels(request.getChannels())
                .build();
        entity = alertRuleRepository.save(entity);
        log.info("Created alert rule: id={} name={}", entity.getId(), entity.getName());
        return toRuleResponse(entity);
    }

    public List<AlertRuleResponse> listRules() {
        return alertRuleRepository.findAll().stream()
                .map(this::toRuleResponse)
                .toList();
    }

    @Transactional
    public AlertRuleResponse updateRule(UUID id, AlertRuleRequest request) {
        AlertRuleEntity entity = alertRuleRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Alert rule not found: " + id));
        entity.setName(request.getName());
        entity.setMetric(request.getMetric());
        entity.setCondition(request.getCondition());
        entity.setThreshold(request.getThreshold());
        entity.setWindowMinutes(request.getWindowMinutes());
        entity.setApiId(request.getApiId());
        entity.setEnabled(request.isEnabled());
        entity.setChannels(request.getChannels());
        entity = alertRuleRepository.save(entity);
        log.info("Updated alert rule: id={}", entity.getId());
        return toRuleResponse(entity);
    }

    @Transactional
    public void deleteRule(UUID id) {
        if (!alertRuleRepository.existsById(id)) {
            throw new EntityNotFoundException("Alert rule not found: " + id);
        }
        alertRuleRepository.deleteById(id);
        log.info("Deleted alert rule: id={}", id);
    }

    // ── Alert History ────────────────────────────────────────────────────

    public Page<AlertHistoryResponse> getAlertHistory(int page, int size, String status) {
        Pageable pageable = PageRequest.of(page, size);
        Page<AlertHistoryEntity> entities;
        if (status != null && !status.isBlank()) {
            entities = alertHistoryRepository.findByStatusOrderByTriggeredAtDesc(status.toUpperCase(), pageable);
        } else {
            entities = alertHistoryRepository.findAllByOrderByTriggeredAtDesc(pageable);
        }
        return entities.map(this::toHistoryResponse);
    }

    @Transactional
    public AlertHistoryResponse acknowledgeAlert(Long alertId, UUID acknowledgedBy) {
        AlertHistoryEntity entity = alertHistoryRepository.findById(alertId)
                .orElseThrow(() -> new EntityNotFoundException("Alert history not found: " + alertId));
        entity.setStatus("ACKNOWLEDGED");
        entity.setAcknowledgedAt(Instant.now());
        entity.setAcknowledgedBy(acknowledgedBy);
        entity = alertHistoryRepository.save(entity);
        log.info("Alert acknowledged: id={} by={}", alertId, acknowledgedBy);
        return toHistoryResponse(entity);
    }

    // ── Mappers ──────────────────────────────────────────────────────────

    private AlertRuleResponse toRuleResponse(AlertRuleEntity entity) {
        return AlertRuleResponse.builder()
                .id(entity.getId())
                .name(entity.getName())
                .metric(entity.getMetric())
                .condition(entity.getCondition())
                .threshold(entity.getThreshold())
                .windowMinutes(entity.getWindowMinutes())
                .apiId(entity.getApiId())
                .enabled(entity.isEnabled())
                .channels(entity.getChannels())
                .createdAt(entity.getCreatedAt())
                .build();
    }

    private AlertHistoryResponse toHistoryResponse(AlertHistoryEntity entity) {
        return AlertHistoryResponse.builder()
                .id(entity.getId())
                .ruleId(entity.getRule() != null ? entity.getRule().getId() : null)
                .ruleName(entity.getRule() != null ? entity.getRule().getName() : null)
                .status(entity.getStatus())
                .value(entity.getValue())
                .message(entity.getMessage())
                .triggeredAt(entity.getTriggeredAt())
                .acknowledgedAt(entity.getAcknowledgedAt())
                .acknowledgedBy(entity.getAcknowledgedBy())
                .build();
    }
}

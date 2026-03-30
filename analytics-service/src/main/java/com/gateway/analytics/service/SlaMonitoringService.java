package com.gateway.analytics.service;

import com.gateway.analytics.dto.SlaBreachResponse;
import com.gateway.analytics.dto.SlaConfigRequest;
import com.gateway.analytics.dto.SlaConfigResponse;
import com.gateway.analytics.dto.SlaDashboardEntry;
import com.gateway.analytics.entity.SlaBreachEntity;
import com.gateway.analytics.entity.SlaConfigEntity;
import com.gateway.analytics.repository.SlaBreachRepository;
import com.gateway.analytics.repository.SlaConfigRepository;
import com.gateway.analytics.store.RequestLogStore;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Monitors SLA compliance by evaluating uptime, latency, and error-rate
 * targets on a schedule and recording breaches.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SlaMonitoringService {

    private final SlaConfigRepository slaConfigRepository;
    private final SlaBreachRepository slaBreachRepository;
    private final RequestLogStore requestLogStore;

    private static final int WINDOW_MINUTES = 5;

    // ── Scheduled Evaluation ─────────────────────────────────────────────

    /**
     * Evaluate all enabled SLA configs every 5 minutes.
     */
    @Scheduled(fixedRate = 300_000)
    @Transactional
    public void evaluateSlas() {
        List<SlaConfigEntity> configs = slaConfigRepository.findByEnabledTrue();
        log.debug("Evaluating {} active SLA configs", configs.size());

        for (SlaConfigEntity config : configs) {
            try {
                evaluateConfig(config);
            } catch (Exception e) {
                log.error("Failed to evaluate SLA config {}: {}", config.getId(), e.getMessage(), e);
            }
        }
    }

    private void evaluateConfig(SlaConfigEntity config) {
        Instant now = Instant.now();
        UUID apiId = config.getApiId();

        // ── Uptime check: % of non-5xx responses ────────────────────────
        if (config.getUptimeTarget() != null) {
            BigDecimal uptime = requestLogStore.queryMetric("uptime", WINDOW_MINUTES, apiId);
            if (uptime != null && uptime.compareTo(config.getUptimeTarget()) < 0) {
                recordBreach(config, "UPTIME", config.getUptimeTarget(), uptime,
                        String.format("Uptime %.2f%% is below target %.2f%% for API '%s'",
                                uptime, config.getUptimeTarget(), config.getApiName()),
                        now);
            } else {
                resolveBreaches(config.getId(), "UPTIME");
            }
        }

        // ── Latency P95 check ───────────────────────────────────────────
        if (config.getLatencyTargetMs() != null) {
            BigDecimal p95 = requestLogStore.queryMetric("latency_p95", WINDOW_MINUTES, apiId);
            BigDecimal target = BigDecimal.valueOf(config.getLatencyTargetMs());
            if (p95 != null && p95.compareTo(target) > 0) {
                recordBreach(config, "LATENCY_P95", target, p95,
                        String.format("P95 latency %.0fms exceeds target %dms for API '%s'",
                                p95.doubleValue(), config.getLatencyTargetMs(), config.getApiName()),
                        now);
            } else {
                resolveBreaches(config.getId(), "LATENCY_P95");
            }
        }

        // ── Error rate check: % of 4xx + 5xx ────────────────────────────
        if (config.getErrorBudgetPct() != null) {
            BigDecimal errorRate = requestLogStore.queryMetric("error_rate", WINDOW_MINUTES, apiId);
            if (errorRate != null && errorRate.compareTo(config.getErrorBudgetPct()) > 0) {
                recordBreach(config, "ERROR_RATE", config.getErrorBudgetPct(), errorRate,
                        String.format("Error rate %.2f%% exceeds budget %.2f%% for API '%s'",
                                errorRate, config.getErrorBudgetPct(), config.getApiName()),
                        now);
            } else {
                resolveBreaches(config.getId(), "ERROR_RATE");
            }
        }
    }

    // ── Breach Tracking ─────────────────────────────────────────────────

    private void recordBreach(SlaConfigEntity config, String metric,
                              BigDecimal target, BigDecimal actual,
                              String message, Instant now) {
        // Only create a new breach if there is no unresolved breach for the same metric
        List<SlaBreachEntity> open = slaBreachRepository
                .findBySlaConfigIdAndMetricAndResolvedAtIsNull(config.getId(), metric);
        if (!open.isEmpty()) {
            log.debug("Active breach already exists for config={} metric={}", config.getId(), metric);
            return;
        }

        SlaBreachEntity breach = SlaBreachEntity.builder()
                .apiId(config.getApiId())
                .slaConfigId(config.getId())
                .metric(metric)
                .targetValue(target)
                .actualValue(actual)
                .message(message)
                .breachedAt(now)
                .build();
        slaBreachRepository.save(breach);
        log.info("SLA breach recorded: config={} metric={} actual={} target={}",
                config.getId(), metric, actual, target);
    }

    private void resolveBreaches(UUID slaConfigId, String metric) {
        List<SlaBreachEntity> open = slaBreachRepository
                .findBySlaConfigIdAndMetricAndResolvedAtIsNull(slaConfigId, metric);
        if (!open.isEmpty()) {
            Instant now = Instant.now();
            for (SlaBreachEntity breach : open) {
                breach.setResolvedAt(now);
                slaBreachRepository.save(breach);
                log.info("SLA breach resolved: id={} metric={}", breach.getId(), metric);
            }
        }
    }

    // ── SLA Config CRUD ─────────────────────────────────────────────────

    @Transactional
    public SlaConfigResponse createConfig(SlaConfigRequest request) {
        SlaConfigEntity entity = SlaConfigEntity.builder()
                .apiId(request.getApiId())
                .apiName(request.getApiName())
                .uptimeTarget(request.getUptimeTarget())
                .latencyTargetMs(request.getLatencyTargetMs())
                .errorBudgetPct(request.getErrorBudgetPct())
                .enabled(request.getEnabled() != null ? request.getEnabled() : true)
                .build();
        entity = slaConfigRepository.save(entity);
        log.info("Created SLA config: id={} apiName={}", entity.getId(), entity.getApiName());
        return toConfigResponse(entity);
    }

    public List<SlaConfigResponse> listConfigs() {
        return slaConfigRepository.findAll().stream()
                .map(this::toConfigResponse)
                .toList();
    }

    public SlaConfigResponse getConfig(UUID id) {
        SlaConfigEntity entity = slaConfigRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("SLA config not found: " + id));
        return toConfigResponse(entity);
    }

    @Transactional
    public SlaConfigResponse updateConfig(UUID id, SlaConfigRequest request) {
        SlaConfigEntity entity = slaConfigRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("SLA config not found: " + id));
        entity.setApiId(request.getApiId());
        entity.setApiName(request.getApiName());
        entity.setUptimeTarget(request.getUptimeTarget());
        entity.setLatencyTargetMs(request.getLatencyTargetMs());
        entity.setErrorBudgetPct(request.getErrorBudgetPct());
        if (request.getEnabled() != null) {
            entity.setEnabled(request.getEnabled());
        }
        entity = slaConfigRepository.save(entity);
        log.info("Updated SLA config: id={}", entity.getId());
        return toConfigResponse(entity);
    }

    @Transactional
    public void deleteConfig(UUID id) {
        if (!slaConfigRepository.existsById(id)) {
            throw new EntityNotFoundException("SLA config not found: " + id);
        }
        slaConfigRepository.deleteById(id);
        log.info("Deleted SLA config: id={}", id);
    }

    // ── Breach Queries ──────────────────────────────────────────────────

    public List<SlaBreachResponse> listBreaches(UUID apiId, String range) {
        Instant after = parseRange(range);
        List<SlaBreachEntity> entities;
        if (apiId != null) {
            entities = slaBreachRepository.findByApiIdAndBreachedAtAfterOrderByBreachedAtDesc(apiId, after);
        } else {
            entities = slaBreachRepository.findByBreachedAtAfterOrderByBreachedAtDesc(after);
        }
        return entities.stream().map(this::toBreachResponse).toList();
    }

    // ── Dashboard ───────────────────────────────────────────────────────

    public List<SlaDashboardEntry> getDashboard() {
        List<SlaConfigEntity> configs = slaConfigRepository.findByEnabledTrue();
        List<SlaDashboardEntry> entries = new ArrayList<>();

        for (SlaConfigEntity config : configs) {
            UUID apiId = config.getApiId();

            BigDecimal uptimeActual = requestLogStore.queryMetric("uptime", WINDOW_MINUTES, apiId);
            BigDecimal p95Actual = requestLogStore.queryMetric("latency_p95", WINDOW_MINUTES, apiId);
            BigDecimal errorRateActual = requestLogStore.queryMetric("error_rate", WINDOW_MINUTES, apiId);

            boolean uptimeOk = config.getUptimeTarget() == null || uptimeActual == null
                    || uptimeActual.compareTo(config.getUptimeTarget()) >= 0;
            boolean latencyOk = config.getLatencyTargetMs() == null || p95Actual == null
                    || p95Actual.compareTo(BigDecimal.valueOf(config.getLatencyTargetMs())) <= 0;
            boolean errorOk = config.getErrorBudgetPct() == null || errorRateActual == null
                    || errorRateActual.compareTo(config.getErrorBudgetPct()) <= 0;

            int activeBreaches = slaBreachRepository
                    .findBySlaConfigIdAndMetricAndResolvedAtIsNull(config.getId(), "UPTIME").size()
                    + slaBreachRepository
                    .findBySlaConfigIdAndMetricAndResolvedAtIsNull(config.getId(), "LATENCY_P95").size()
                    + slaBreachRepository
                    .findBySlaConfigIdAndMetricAndResolvedAtIsNull(config.getId(), "ERROR_RATE").size();

            entries.add(SlaDashboardEntry.builder()
                    .apiId(config.getApiId())
                    .apiName(config.getApiName())
                    .uptimeTarget(config.getUptimeTarget())
                    .uptimeActual(uptimeActual)
                    .uptimeCompliant(uptimeOk)
                    .latencyTargetMs(config.getLatencyTargetMs())
                    .latencyP95Actual(p95Actual)
                    .latencyCompliant(latencyOk)
                    .errorBudgetPct(config.getErrorBudgetPct())
                    .errorRateActual(errorRateActual)
                    .errorRateCompliant(errorOk)
                    .overallCompliant(uptimeOk && latencyOk && errorOk)
                    .activeBreaches(activeBreaches)
                    .build());
        }

        return entries;
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private Instant parseRange(String range) {
        if (range == null || range.isBlank()) {
            range = "24h";
        }
        range = range.trim().toLowerCase();
        if (range.endsWith("h")) {
            int hours = Integer.parseInt(range.replace("h", ""));
            return Instant.now().minus(Duration.ofHours(hours));
        } else if (range.endsWith("d")) {
            int days = Integer.parseInt(range.replace("d", ""));
            return Instant.now().minus(Duration.ofDays(days));
        } else if (range.endsWith("m")) {
            int minutes = Integer.parseInt(range.replace("m", ""));
            return Instant.now().minus(Duration.ofMinutes(minutes));
        }
        return Instant.now().minus(Duration.ofHours(24));
    }

    // ── Mappers ─────────────────────────────────────────────────────────

    private SlaConfigResponse toConfigResponse(SlaConfigEntity entity) {
        return SlaConfigResponse.builder()
                .id(entity.getId())
                .apiId(entity.getApiId())
                .apiName(entity.getApiName())
                .uptimeTarget(entity.getUptimeTarget())
                .latencyTargetMs(entity.getLatencyTargetMs())
                .errorBudgetPct(entity.getErrorBudgetPct())
                .enabled(entity.getEnabled())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .build();
    }

    private SlaBreachResponse toBreachResponse(SlaBreachEntity entity) {
        String apiName = null;
        if (entity.getSlaConfigId() != null) {
            apiName = slaConfigRepository.findById(entity.getSlaConfigId())
                    .map(SlaConfigEntity::getApiName)
                    .orElse(null);
        }
        return SlaBreachResponse.builder()
                .id(entity.getId())
                .apiId(entity.getApiId())
                .apiName(apiName)
                .slaConfigId(entity.getSlaConfigId())
                .metric(entity.getMetric())
                .targetValue(entity.getTargetValue())
                .actualValue(entity.getActualValue())
                .message(entity.getMessage())
                .breachedAt(entity.getBreachedAt())
                .resolvedAt(entity.getResolvedAt())
                .build();
    }
}

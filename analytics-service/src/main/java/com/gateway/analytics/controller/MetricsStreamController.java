package com.gateway.analytics.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.analytics.dto.MetricsStreamEvent;
import com.gateway.analytics.store.RequestLogStore;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

@Slf4j
@RestController
@RequestMapping("/v1/analytics")
@RequiredArgsConstructor
public class MetricsStreamController {

    private static final long SSE_TIMEOUT = 5 * 60 * 1000L; // 5 minutes

    private final RequestLogStore store;
    private final ObjectMapper objectMapper;
    private final JdbcTemplate jdbcTemplate;
    private final CopyOnWriteArrayList<SseEmitter> emitters = new CopyOnWriteArrayList<>();

    @GetMapping("/stream")
    public SseEmitter streamMetrics() {
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT);
        emitters.add(emitter);

        emitter.onCompletion(() -> {
            emitters.remove(emitter);
            log.debug("SSE emitter completed, active emitters: {}", emitters.size());
        });
        emitter.onTimeout(() -> {
            emitters.remove(emitter);
            log.debug("SSE emitter timed out, active emitters: {}", emitters.size());
        });
        emitter.onError(e -> {
            emitters.remove(emitter);
            log.debug("SSE emitter error: {}, active emitters: {}", e.getMessage(), emitters.size());
        });

        log.debug("New SSE subscriber connected, active emitters: {}", emitters.size());
        return emitter;
    }

    @Scheduled(fixedRate = 5000)
    public void pushMetrics() {
        if (emitters.isEmpty()) {
            return;
        }

        try {
            MetricsStreamEvent event = buildCurrentMetrics();
            String json = objectMapper.writeValueAsString(event);

            for (SseEmitter emitter : emitters) {
                try {
                    emitter.send(SseEmitter.event()
                            .name("metrics")
                            .data(json));
                } catch (IOException e) {
                    emitters.remove(emitter);
                }
            }
        } catch (Exception e) {
            log.error("Failed to build or push metrics event: {}", e.getMessage(), e);
        }
    }

    private MetricsStreamEvent buildCurrentMetrics() {
        Map<String, Object> stats = store.getRealtimeMetrics();

        long totalRequests = ((Number) stats.get("totalRequests")).longValue();
        double currentRps = ((Number) stats.get("currentRps")).doubleValue();

        // Active alerts (TRIGGERED and not acknowledged) — queries alert_history table
        String alertSql = """
            SELECT ah.message
            FROM analytics.alert_history ah
            WHERE ah.status = 'TRIGGERED'
              AND ah.triggered_at >= NOW() - INTERVAL '1 hour'
            ORDER BY ah.triggered_at DESC
            LIMIT 10
            """;

        List<String> activeAlerts;
        try {
            activeAlerts = jdbcTemplate.queryForList(alertSql, String.class);
        } catch (Exception e) {
            log.debug("Could not fetch active alerts: {}", e.getMessage());
            activeAlerts = List.of();
        }

        return MetricsStreamEvent.builder()
                .timestamp(Instant.now())
                .currentRps(currentRps)
                .errorRate(((Number) stats.get("errorRate")).doubleValue())
                .avgLatencyMs(((Number) stats.get("avgLatencyMs")).doubleValue())
                .p99LatencyMs(((Number) stats.get("p99LatencyMs")).doubleValue())
                .activeAlerts(activeAlerts)
                .build();
    }
}

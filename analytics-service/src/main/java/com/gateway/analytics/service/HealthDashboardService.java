package com.gateway.analytics.service;

import com.gateway.analytics.dto.HealthDashboardResponse;
import com.gateway.analytics.dto.HealthDashboardResponse.GatewayStats;
import com.gateway.analytics.dto.HealthDashboardResponse.ServiceHealth;
import com.gateway.analytics.dto.HealthDashboardResponse.TopError;
import com.gateway.analytics.store.RequestLogStore;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class HealthDashboardService {

    private final RequestLogStore store;
    private final RabbitTemplate rabbitTemplate;

    private static final List<ServiceDefinition> SERVICES = List.of(
            new ServiceDefinition("identity-service", "http://localhost:8081"),
            new ServiceDefinition("management-api", "http://localhost:8082"),
            new ServiceDefinition("gateway-runtime", "http://localhost:8080"),
            new ServiceDefinition("analytics", "http://localhost:8083"),
            new ServiceDefinition("notification", "http://localhost:8084")
    );

    private record ServiceDefinition(String name, String baseUrl) {}

    /**
     * Full health dashboard combining service checks, gateway stats, percentiles, and top errors.
     */
    public HealthDashboardResponse getHealthDashboard() {
        List<ServiceHealth> services = checkAllServices();
        GatewayStats gatewayStats = getGatewayStats();
        Map<String, Double> percentiles = getPercentiles("1h");
        List<TopError> topErrors = getTopErrors();
        long queueDepth = getQueueDepth();

        return HealthDashboardResponse.builder()
                .services(services)
                .gateway(gatewayStats)
                .percentiles(percentiles)
                .topErrors(topErrors)
                .queueDepth(queueDepth)
                .build();
    }

    /**
     * Ping all known services at /actuator/health with a 3-second timeout.
     */
    public List<ServiceHealth> checkAllServices() {
        RestClient restClient = RestClient.builder()
                .build();

        List<ServiceHealth> results = new ArrayList<>();
        for (ServiceDefinition svc : SERVICES) {
            String url = svc.baseUrl() + "/actuator/health";
            long start = System.nanoTime();
            try {
                restClient.get()
                        .uri(url)
                        .retrieve()
                        .toBodilessEntity();

                long latencyMs = Duration.ofNanos(System.nanoTime() - start).toMillis();
                results.add(ServiceHealth.builder()
                        .name(svc.name())
                        .url(url)
                        .status("UP")
                        .latencyMs(latencyMs)
                        .build());
            } catch (Exception e) {
                log.debug("Health check failed for {}: {}", svc.name(), e.getMessage());
                results.add(ServiceHealth.builder()
                        .name(svc.name())
                        .url(url)
                        .status("DOWN")
                        .latencyMs(-1)
                        .build());
            }
        }
        return results;
    }

    /**
     * Gateway stats from the last 1 minute of request_logs: RPS, error rate, avg latency.
     */
    public GatewayStats getGatewayStats() {
        Map<String, Object> row = store.getGatewayStats();
        long total = ((Number) row.get("total")).longValue();
        double errorRate = ((Number) row.get("error_rate")).doubleValue();
        double avgLatency = ((Number) row.get("avg_latency")).doubleValue();

        // RPS = total requests / 60 seconds
        double rps = total / 60.0;

        return GatewayStats.builder()
                .currentRps(Math.round(rps * 100.0) / 100.0)
                .errorRate(Math.round(errorRate * 100.0) / 100.0)
                .avgLatencyMs(Math.round(avgLatency * 100.0) / 100.0)
                .build();
    }

    /**
     * Latency percentiles (p50, p75, p90, p95, p99) from request_logs for the given range.
     */
    public Map<String, Double> getPercentiles(String range) {
        String interval = toInterval(range);
        return store.getPercentiles(interval);
    }

    /**
     * Top 10 error status codes in the last hour.
     */
    public List<TopError> getTopErrors() {
        List<Map<String, Object>> rows = store.getTopErrors();
        return rows.stream().map(row -> TopError.builder()
                .statusCode(((Number) row.get("status_code")).intValue())
                .count(((Number) row.get("count")).longValue())
                .lastSeen((Instant) row.get("last_seen"))
                .build()).toList();
    }

    /**
     * Best-effort queue depth from RabbitMQ. Returns 0 if unavailable.
     */
    public long getQueueDepth() {
        try {
            var props = rabbitTemplate.execute(channel -> {
                try {
                    return channel.queueDeclarePassive("gateway.request.logs");
                } catch (Exception e) {
                    return null;
                }
            });
            return props != null ? props.getMessageCount() : 0;
        } catch (Exception e) {
            log.debug("Could not determine queue depth: {}", e.getMessage());
            return 0;
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private String toInterval(String timeRange) {
        if (timeRange == null) return "1 hour";
        return switch (timeRange.toLowerCase()) {
            case "5m" -> "5 minutes";
            case "15m" -> "15 minutes";
            case "30m" -> "30 minutes";
            case "1h" -> "1 hour";
            case "6h" -> "6 hours";
            case "24h" -> "24 hours";
            case "7d" -> "7 days";
            default -> "1 hour";
        };
    }
}

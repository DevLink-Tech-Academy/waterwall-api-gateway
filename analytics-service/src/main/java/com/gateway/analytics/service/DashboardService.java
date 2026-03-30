package com.gateway.analytics.service;

import com.gateway.analytics.dto.ApiComparisonEntry;
import com.gateway.analytics.dto.ApiMetricsResponse;
import com.gateway.analytics.dto.DashboardResponse;
import com.gateway.analytics.dto.TopApiEntry;
import com.gateway.analytics.dto.TopConsumerEntry;
import com.gateway.analytics.store.RequestLogStore;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

@Slf4j
@Service
public class DashboardService {

    private final RequestLogStore store;

    public DashboardService(RequestLogStore store) {
        this.store = store;
    }

    /**
     * Platform-wide dashboard stats for the given time range.
     */
    public DashboardResponse getDashboard(String timeRange) {
        String interval = toInterval(timeRange);

        DashboardResponse stats = store.getDashboardStats(interval);
        Map<String, Long> statusCodeBreakdown = store.getStatusCodeBreakdown(interval);

        return DashboardResponse.builder()
                .totalRequests(stats.getTotalRequests())
                .avgLatencyMs(stats.getAvgLatencyMs())
                .avgLatency(stats.getAvgLatency())
                .errorRate(stats.getErrorRate())
                .activeApis(stats.getActiveApis())
                .statusCodeBreakdown(statusCodeBreakdown)
                .build();
    }

    /**
     * Metrics for a specific API.
     */
    public ApiMetricsResponse getApiMetrics(UUID apiId, String timeRange) {
        String interval = toInterval(timeRange);
        return store.getApiMetrics(apiId, interval);
    }

    /**
     * Top APIs by the given metric.
     */
    public List<TopApiEntry> getTopApis(int limit, String metric, String timeRange) {
        String interval = toInterval(timeRange);
        return store.getTopApis(limit, metric, interval);
    }

    /**
     * Top consumers by request count.
     */
    public List<TopConsumerEntry> getTopConsumers(int limit, String timeRange) {
        String interval = toInterval(timeRange);
        return store.getTopConsumers(limit, interval);
    }

    /**
     * Export dashboard data as CSV string.
     */
    public String exportCsv(String timeRange) {
        DashboardResponse dashboard = getDashboard(timeRange);
        List<TopApiEntry> topApis = getTopApis(50, "requests", timeRange);

        StringBuilder csv = new StringBuilder();
        csv.append("# Platform Dashboard Export\n");
        csv.append("# Time Range: ").append(timeRange).append("\n\n");

        csv.append("# Summary\n");
        csv.append("total_requests,avg_latency_ms,error_rate\n");
        csv.append(dashboard.getTotalRequests()).append(",")
                .append(dashboard.getAvgLatencyMs()).append(",")
                .append(dashboard.getErrorRate()).append("\n\n");

        csv.append("# Top APIs\n");
        csv.append("api_id,request_count,error_count,avg_latency_ms,error_rate\n");
        for (TopApiEntry entry : topApis) {
            csv.append(entry.getApiId()).append(",")
                    .append(entry.getRequestCount()).append(",")
                    .append(entry.getErrorCount()).append(",")
                    .append(entry.getAvgLatencyMs()).append(",")
                    .append(entry.getErrorRate()).append("\n");
        }

        return csv.toString();
    }

    /**
     * Latency percentiles (p50, p75, p90, p95, p99) from request_logs for the given range.
     */
    public Map<String, Double> getPercentiles(String timeRange) {
        String interval = toInterval(timeRange);
        return store.getPercentiles(interval);
    }

    /**
     * Compare multiple APIs side by side.
     */
    public List<ApiComparisonEntry> compareApis(List<UUID> apiIds, String timeRange) {
        if (apiIds == null || apiIds.isEmpty()) {
            return List.of();
        }
        String interval = toInterval(timeRange);
        return store.compareApis(apiIds, interval);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private String toInterval(String timeRange) {
        if (timeRange == null) return "24 hours";
        return switch (timeRange.toLowerCase()) {
            case "1h" -> "1 hour";
            case "6h" -> "6 hours";
            case "24h" -> "24 hours";
            case "7d" -> "7 days";
            case "30d" -> "30 days";
            default -> "24 hours";
        };
    }
}

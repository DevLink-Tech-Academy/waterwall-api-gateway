package com.gateway.analytics.store;

import com.gateway.analytics.dto.*;
import com.gateway.analytics.entity.RequestLogEntity;
import com.gateway.analytics.repository.RequestLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

@Slf4j
@Service
@Profile("!clickhouse")
@Primary
@RequiredArgsConstructor
public class PostgresRequestLogStore implements RequestLogStore {

    private final JdbcTemplate jdbcTemplate;
    private final RequestLogRepository requestLogRepository;

    /**
     * Allowlist of safe interval values. Any user-supplied interval must match
     * one of these patterns. This prevents SQL injection via the INTERVAL clause.
     */
    private static final Map<String, String> INTERVAL_ALLOWLIST = Map.ofEntries(
            Map.entry("1h", "1 hour"), Map.entry("6h", "6 hours"), Map.entry("12h", "12 hours"),
            Map.entry("24h", "24 hours"), Map.entry("48h", "48 hours"),
            Map.entry("7d", "7 days"), Map.entry("14d", "14 days"), Map.entry("30d", "30 days"),
            Map.entry("60d", "60 days"), Map.entry("90d", "90 days"), Map.entry("180d", "180 days"),
            Map.entry("365d", "365 days"),
            Map.entry("1 hour", "1 hour"), Map.entry("6 hours", "6 hours"), Map.entry("12 hours", "12 hours"),
            Map.entry("24 hours", "24 hours"), Map.entry("48 hours", "48 hours"),
            Map.entry("7 days", "7 days"), Map.entry("14 days", "14 days"), Map.entry("30 days", "30 days"),
            Map.entry("60 days", "60 days"), Map.entry("90 days", "90 days"), Map.entry("180 days", "180 days"),
            Map.entry("365 days", "365 days")
    );

    private static String sanitizeInterval(String interval) {
        if (interval == null || interval.isBlank()) return "24 hours";
        String key = interval.trim().toLowerCase();
        String safe = INTERVAL_ALLOWLIST.get(key);
        if (safe != null) return safe;
        // Try to parse as "<number> <unit>" pattern strictly
        if (key.matches("^\\d{1,4}\\s*(hours?|days?|minutes?)$")) {
            return key;
        }
        log.warn("Rejected unsafe interval value: '{}', defaulting to '24 hours'", interval);
        return "24 hours";
    }

    // ── Ingest ──────────────────────────────────────────────────────────

    @Override
    public void save(RequestLogEntity entity) {
        requestLogRepository.save(entity);
    }

    // ── DashboardService ────────────────────────────────────────────────

    @Override
    public DashboardResponse getDashboardStats(String interval) {
        String sql = """
            SELECT
                COUNT(*) AS total_requests,
                COALESCE(AVG(latency_ms), 0) AS avg_latency,
                COALESCE(
                    COUNT(*) FILTER (WHERE status_code >= 400) * 100.0 / NULLIF(COUNT(*), 0),
                    0
                ) AS error_rate,
                COUNT(DISTINCT api_id) AS active_apis
            FROM analytics.request_logs
            WHERE created_at >= NOW() - INTERVAL '%s'
            """.formatted(sanitizeInterval(interval));

        Map<String, Object> stats = jdbcTemplate.queryForMap(sql);

        long totalRequests = ((Number) stats.get("total_requests")).longValue();
        double avgLatency = ((Number) stats.get("avg_latency")).doubleValue();
        double errorRate = ((Number) stats.get("error_rate")).doubleValue();
        long activeApis = ((Number) stats.get("active_apis")).longValue();

        double roundedLatency = Math.round(avgLatency * 100.0) / 100.0;
        return DashboardResponse.builder()
                .totalRequests(totalRequests)
                .avgLatencyMs(roundedLatency)
                .avgLatency(roundedLatency)
                .errorRate(Math.round(errorRate * 100.0) / 100.0)
                .activeApis(activeApis)
                .statusCodeBreakdown(getStatusCodeBreakdown(interval))
                .build();
    }

    @Override
    public Map<String, Long> getStatusCodeBreakdown(String interval) {
        String breakdownSql = """
            SELECT
                CAST(status_code / 100 AS TEXT) || 'xx' AS status_group,
                COUNT(*) AS cnt
            FROM analytics.request_logs
            WHERE created_at >= NOW() - INTERVAL '%s'
            GROUP BY status_code / 100
            ORDER BY status_group
            """.formatted(sanitizeInterval(interval));

        Map<String, Long> statusCodeBreakdown = new LinkedHashMap<>();
        jdbcTemplate.query(breakdownSql, (rs, rowNum) -> {
            statusCodeBreakdown.put(rs.getString("status_group"), rs.getLong("cnt"));
            return null;
        });
        return statusCodeBreakdown;
    }

    @Override
    public List<TopApiEntry> getTopApis(int limit, String metric, String interval) {
        String orderBy = switch (metric != null ? metric.toLowerCase() : "requests") {
            case "errors" -> "error_count DESC";
            case "latency" -> "avg_latency DESC";
            case "error_rate" -> "error_rate DESC";
            default -> "request_count DESC";
        };

        String sql = """
            SELECT
                r.api_id,
                COALESCE(a.name, CAST(r.api_id AS text)) AS api_name,
                COUNT(*) AS request_count,
                COUNT(*) FILTER (WHERE r.status_code >= 400) AS error_count,
                COALESCE(AVG(r.latency_ms), 0) AS avg_latency,
                COALESCE(
                    COUNT(*) FILTER (WHERE r.status_code >= 400) * 100.0 / NULLIF(COUNT(*), 0),
                    0
                ) AS error_rate
            FROM analytics.request_logs r
            LEFT JOIN gateway.apis a ON a.id = r.api_id
            WHERE r.created_at >= NOW() - INTERVAL '%s'
            GROUP BY r.api_id, a.name
            ORDER BY %s
            LIMIT ?
            """.formatted(sanitizeInterval(interval), orderBy);

        return jdbcTemplate.query(sql, (rs, rowNum) -> TopApiEntry.builder()
                .apiId(rs.getObject("api_id", UUID.class))
                .apiName(rs.getString("api_name"))
                .requestCount(rs.getLong("request_count"))
                .errorCount(rs.getLong("error_count"))
                .avgLatencyMs(Math.round(rs.getDouble("avg_latency") * 100.0) / 100.0)
                .errorRate(Math.round(rs.getDouble("error_rate") * 100.0) / 100.0)
                .build(), limit);
    }

    @Override
    public List<TopConsumerEntry> getTopConsumers(int limit, String interval) {
        String sql = """
            SELECT
                r.consumer_id,
                COALESCE(u.email, CAST(r.consumer_id AS text)) AS consumer_name,
                COUNT(*) AS request_count,
                COUNT(*) FILTER (WHERE r.status_code >= 400) AS error_count,
                COALESCE(AVG(r.latency_ms), 0) AS avg_latency
            FROM analytics.request_logs r
            LEFT JOIN identity.users u ON u.id = r.consumer_id
            WHERE r.consumer_id IS NOT NULL
              AND r.created_at >= NOW() - INTERVAL '%s'
            GROUP BY r.consumer_id, u.email
            ORDER BY request_count DESC
            LIMIT ?
            """.formatted(sanitizeInterval(interval));

        return jdbcTemplate.query(sql, (rs, rowNum) -> TopConsumerEntry.builder()
                .consumerId(rs.getObject("consumer_id", UUID.class))
                .consumerName(rs.getString("consumer_name"))
                .requestCount(rs.getLong("request_count"))
                .errorCount(rs.getLong("error_count"))
                .avgLatencyMs(Math.round(rs.getDouble("avg_latency") * 100.0) / 100.0)
                .build(), limit);
    }

    @Override
    public Map<String, Double> getPercentiles(String interval) {
        String sql = """
            SELECT
                PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY latency_ms) AS p50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY latency_ms) AS p75,
                PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY latency_ms) AS p90,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
                PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99
            FROM analytics.request_logs
            WHERE created_at >= NOW() - INTERVAL '%s'
            """.formatted(sanitizeInterval(interval));

        Map<String, Object> row = jdbcTemplate.queryForMap(sql);

        Map<String, Double> percentiles = new LinkedHashMap<>();
        percentiles.put("p50", toDouble(row.get("p50")));
        percentiles.put("p75", toDouble(row.get("p75")));
        percentiles.put("p90", toDouble(row.get("p90")));
        percentiles.put("p95", toDouble(row.get("p95")));
        percentiles.put("p99", toDouble(row.get("p99")));
        return percentiles;
    }

    @Override
    public List<ApiComparisonEntry> compareApis(List<UUID> apiIds, String interval) {
        if (apiIds == null || apiIds.isEmpty()) {
            return List.of();
        }

        double intervalSeconds = toSeconds(interval);

        // Build IN clause with positional parameters
        String placeholders = String.join(",", apiIds.stream().map(id -> "?").toList());

        String sql = """
            SELECT
                api_id,
                COUNT(*) AS total_requests,
                COALESCE(AVG(latency_ms), 0) AS avg_latency,
                COALESCE(
                    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms),
                    0
                ) AS p50_latency,
                COALESCE(
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms),
                    0
                ) AS p95_latency,
                COALESCE(
                    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms),
                    0
                ) AS p99_latency,
                COALESCE(
                    COUNT(*) FILTER (WHERE status_code >= 400) * 100.0 / NULLIF(COUNT(*), 0),
                    0
                ) AS error_rate
            FROM analytics.request_logs
            WHERE api_id IN (%s)
              AND created_at >= NOW() - INTERVAL '%s'
            GROUP BY api_id
            ORDER BY total_requests DESC
            """.formatted(placeholders, sanitizeInterval(interval));

        Object[] params = apiIds.toArray();

        return jdbcTemplate.query(sql, (rs, rowNum) -> {
            long totalRequests = rs.getLong("total_requests");
            double throughputRps = intervalSeconds > 0 ? totalRequests / intervalSeconds : 0;

            return ApiComparisonEntry.builder()
                    .apiId(rs.getObject("api_id", UUID.class))
                    .apiName(null) // API name not stored in request_logs; enrich externally if needed
                    .totalRequests(totalRequests)
                    .avgLatencyMs(Math.round(rs.getDouble("avg_latency") * 100.0) / 100.0)
                    .p50LatencyMs(Math.round(rs.getDouble("p50_latency") * 100.0) / 100.0)
                    .p95LatencyMs(Math.round(rs.getDouble("p95_latency") * 100.0) / 100.0)
                    .p99LatencyMs(Math.round(rs.getDouble("p99_latency") * 100.0) / 100.0)
                    .errorRate(Math.round(rs.getDouble("error_rate") * 100.0) / 100.0)
                    .throughputRps(Math.round(throughputRps * 100.0) / 100.0)
                    .build();
        }, params);
    }

    @Override
    public ApiMetricsResponse getApiMetrics(UUID apiId, String interval) {
        String sql = """
            SELECT
                COUNT(*) AS total_requests,
                COUNT(*) FILTER (WHERE status_code >= 400) AS total_errors,
                COALESCE(AVG(latency_ms), 0) AS avg_latency,
                COALESCE(MAX(latency_ms), 0) AS max_latency,
                COALESCE(
                    COUNT(*) FILTER (WHERE status_code >= 400) * 100.0 / NULLIF(COUNT(*), 0),
                    0
                ) AS error_rate
            FROM analytics.request_logs
            WHERE api_id = ?
              AND created_at >= NOW() - INTERVAL '%s'
            """.formatted(sanitizeInterval(interval));

        Map<String, Object> stats = jdbcTemplate.queryForMap(sql, apiId);

        // Status code breakdown for this API
        String breakdownSql = """
            SELECT
                CAST(status_code / 100 AS TEXT) || 'xx' AS status_group,
                COUNT(*) AS cnt
            FROM analytics.request_logs
            WHERE api_id = ?
              AND created_at >= NOW() - INTERVAL '%s'
            GROUP BY status_code / 100
            ORDER BY status_group
            """.formatted(sanitizeInterval(interval));

        Map<String, Long> statusCodeBreakdown = new LinkedHashMap<>();
        jdbcTemplate.query(breakdownSql, (rs, rowNum) -> {
            statusCodeBreakdown.put(rs.getString("status_group"), rs.getLong("cnt"));
            return null;
        }, apiId);

        return ApiMetricsResponse.builder()
                .apiId(apiId)
                .totalRequests(((Number) stats.get("total_requests")).longValue())
                .totalErrors(((Number) stats.get("total_errors")).longValue())
                .avgLatencyMs(Math.round(((Number) stats.get("avg_latency")).doubleValue() * 100.0) / 100.0)
                .maxLatencyMs(((Number) stats.get("max_latency")).intValue())
                .errorRate(Math.round(((Number) stats.get("error_rate")).doubleValue() * 100.0) / 100.0)
                .statusCodeBreakdown(statusCodeBreakdown)
                .timeRange(interval)
                .build();
    }

    // ── HealthDashboardService ──────────────────────────────────────────

    @Override
    public Map<String, Object> getGatewayStats() {
        String sql = """
            SELECT
                COUNT(*) AS total,
                COALESCE(
                    COUNT(*) FILTER (WHERE status_code >= 400) * 100.0 / NULLIF(COUNT(*), 0),
                    0
                ) AS error_rate,
                COALESCE(AVG(latency_ms), 0) AS avg_latency
            FROM analytics.request_logs
            WHERE created_at >= NOW() - INTERVAL '1 minute'
            """;

        Map<String, Object> row = jdbcTemplate.queryForMap(sql);
        long total = ((Number) row.get("total")).longValue();
        double errorRate = ((Number) row.get("error_rate")).doubleValue();
        double avgLatency = ((Number) row.get("avg_latency")).doubleValue();

        // RPS = total requests / 60 seconds
        double rps = total / 60.0;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("currentRps", Math.round(rps * 100.0) / 100.0);
        result.put("errorRate", Math.round(errorRate * 100.0) / 100.0);
        result.put("avgLatencyMs", Math.round(avgLatency * 100.0) / 100.0);
        return result;
    }

    @Override
    public List<Map<String, Object>> getTopErrors() {
        String sql = """
            SELECT
                status_code,
                COUNT(*) AS cnt,
                MAX(created_at) AS last_seen
            FROM analytics.request_logs
            WHERE status_code >= 400
              AND created_at >= NOW() - INTERVAL '1 hour'
            GROUP BY status_code
            ORDER BY cnt DESC
            LIMIT 10
            """;

        return jdbcTemplate.query(sql, (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("status_code", rs.getInt("status_code"));
            row.put("count", rs.getLong("cnt"));
            row.put("last_seen", rs.getTimestamp("last_seen").toInstant());
            return row;
        });
    }

    // ── AlertingService + SlaMonitoringService ──────────────────────────

    @Override
    public BigDecimal queryMetric(String metric, int windowMinutes, UUID apiId) {
        String interval = windowMinutes + " minutes";
        String apiFilter = apiId != null ? " AND api_id = '" + apiId + "'" : "";

        String sql = switch (metric.toLowerCase()) {
            case "error_rate" -> """
                SELECT COALESCE(
                    COUNT(*) FILTER (WHERE status_code >= 400) * 100.0 / NULLIF(COUNT(*), 0),
                    0
                ) AS value
                FROM analytics.request_logs
                WHERE created_at >= NOW() - INTERVAL '%s' AND (mock_mode IS NULL OR mock_mode = false)%s
                """.formatted(sanitizeInterval(interval), apiFilter);

            case "avg_latency" -> """
                SELECT COALESCE(AVG(latency_ms), 0) AS value
                FROM analytics.request_logs
                WHERE created_at >= NOW() - INTERVAL '%s' AND (mock_mode IS NULL OR mock_mode = false)%s
                """.formatted(sanitizeInterval(interval), apiFilter);

            case "request_count", "requests_per_min" -> """
                SELECT COUNT(*) AS value
                FROM analytics.request_logs
                WHERE created_at >= NOW() - INTERVAL '%s' AND (mock_mode IS NULL OR mock_mode = false)%s
                """.formatted(sanitizeInterval(interval), apiFilter);

            case "p99_latency", "latency_p99" -> """
                SELECT COALESCE(
                    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms),
                    0
                ) AS value
                FROM analytics.request_logs
                WHERE created_at >= NOW() - INTERVAL '%s' AND (mock_mode IS NULL OR mock_mode = false)%s
                """.formatted(sanitizeInterval(interval), apiFilter);

            case "uptime" -> """
                SELECT COALESCE(
                    COUNT(*) FILTER (WHERE status_code < 500) * 100.0 / NULLIF(COUNT(*), 0),
                    100
                ) AS value
                FROM analytics.request_logs
                WHERE created_at >= NOW() - INTERVAL '%s'
                  AND (mock_mode IS NULL OR mock_mode = false)%s
                """.formatted(sanitizeInterval(interval), apiFilter);

            case "latency_p95" -> """
                SELECT COALESCE(
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms),
                    0
                ) AS value
                FROM analytics.request_logs
                WHERE created_at >= NOW() - INTERVAL '%s'
                  AND (mock_mode IS NULL OR mock_mode = false)%s
                """.formatted(sanitizeInterval(interval), apiFilter);

            default -> {
                log.warn("Unknown metric: {}", metric);
                yield null;
            }
        };

        if (sql == null) return null;

        try {
            Map<String, Object> result = jdbcTemplate.queryForMap(sql);
            Object value = result.get("value");
            if (value instanceof Number number) {
                return BigDecimal.valueOf(number.doubleValue());
            }
            return null;
        } catch (Exception e) {
            log.debug("Failed to query metric {}: {}", metric, e.getMessage());
            return null;
        }
    }

    // ── MetricsStreamController ─────────────────────────────────────────

    @Override
    public Map<String, Object> getRealtimeMetrics() {
        String sql = """
            SELECT
                COUNT(*) AS total_requests,
                COALESCE(AVG(latency_ms), 0) AS avg_latency,
                COALESCE(
                    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms),
                    0
                ) AS p99_latency,
                COALESCE(
                    COUNT(*) FILTER (WHERE status_code >= 400) * 100.0 / NULLIF(COUNT(*), 0),
                    0
                ) AS error_rate,
                EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) AS window_seconds
            FROM analytics.request_logs
            WHERE created_at >= NOW() - INTERVAL '60 seconds'
            """;

        Map<String, Object> stats = jdbcTemplate.queryForMap(sql);

        long totalRequests = ((Number) stats.get("total_requests")).longValue();
        double windowSeconds = stats.get("window_seconds") != null
                ? ((Number) stats.get("window_seconds")).doubleValue() : 60.0;
        double rps = windowSeconds > 0 ? totalRequests / Math.max(windowSeconds, 1.0) : 0;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalRequests", totalRequests);
        result.put("currentRps", Math.round(rps * 100.0) / 100.0);
        result.put("errorRate", Math.round(((Number) stats.get("error_rate")).doubleValue() * 100.0) / 100.0);
        result.put("avgLatencyMs", Math.round(((Number) stats.get("avg_latency")).doubleValue() * 100.0) / 100.0);
        result.put("p99LatencyMs", Math.round(((Number) stats.get("p99_latency")).doubleValue() * 100.0) / 100.0);
        return result;
    }

    // ── ReportSchedulerService ──────────────────────────────────────────

    @Override
    public Map<String, Object> getReportSummary(String interval) {
        String sql = """
            SELECT
                COUNT(*) AS total_requests,
                COALESCE(AVG(latency_ms), 0) AS avg_latency,
                COALESCE(
                    COUNT(*) FILTER (WHERE status_code >= 400) * 100.0 / NULLIF(COUNT(*), 0),
                    0
                ) AS error_rate
            FROM analytics.request_logs
            WHERE created_at >= NOW() - INTERVAL '%s'
            """.formatted(sanitizeInterval(interval));
        return jdbcTemplate.queryForMap(sql);
    }

    @Override
    public List<Map<String, Object>> getReportTopApis(String interval, int limit) {
        String sql = """
            SELECT
                api_id,
                COUNT(*) AS request_count,
                COUNT(*) FILTER (WHERE status_code >= 400) AS error_count,
                COALESCE(AVG(latency_ms), 0) AS avg_latency,
                COALESCE(
                    COUNT(*) FILTER (WHERE status_code >= 400) * 100.0 / NULLIF(COUNT(*), 0),
                    0
                ) AS error_rate
            FROM analytics.request_logs
            WHERE created_at >= NOW() - INTERVAL '%s'
            GROUP BY api_id
            ORDER BY request_count DESC
            LIMIT ?
            """.formatted(sanitizeInterval(interval));

        return jdbcTemplate.query(sql, (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("api_id", rs.getObject("api_id", UUID.class));
            row.put("request_count", rs.getLong("request_count"));
            row.put("error_count", rs.getLong("error_count"));
            row.put("avg_latency", Math.round(rs.getDouble("avg_latency") * 100.0) / 100.0);
            row.put("error_rate", Math.round(rs.getDouble("error_rate") * 100.0) / 100.0);
            return row;
        }, limit);
    }

    @Override
    public List<Map<String, Object>> getReportTopErrors(String interval, int limit) {
        String sql = """
            SELECT
                status_code,
                COALESCE(error_code, 'UNKNOWN') AS error_code,
                COUNT(*) AS cnt
            FROM analytics.request_logs
            WHERE status_code >= 400
              AND created_at >= NOW() - INTERVAL '%s'
            GROUP BY status_code, error_code
            ORDER BY cnt DESC
            LIMIT ?
            """.formatted(sanitizeInterval(interval));

        return jdbcTemplate.query(sql, (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("status_code", rs.getInt("status_code"));
            row.put("error_code", rs.getString("error_code"));
            row.put("cnt", rs.getLong("cnt"));
            return row;
        }, limit);
    }

    @Override
    public List<Map<String, Object>> getReportSlaViolations(String interval) {
        String sql = """
            SELECT
                api_id,
                COALESCE(AVG(latency_ms), 0) AS avg_latency,
                COALESCE(
                    COUNT(*) FILTER (WHERE status_code >= 400) * 100.0 / NULLIF(COUNT(*), 0),
                    0
                ) AS error_rate
            FROM analytics.request_logs
            WHERE created_at >= NOW() - INTERVAL '%s'
            GROUP BY api_id
            HAVING AVG(latency_ms) > 1000
               OR (COUNT(*) FILTER (WHERE status_code >= 400) * 100.0 / NULLIF(COUNT(*), 0)) > 5
            """.formatted(sanitizeInterval(interval));

        return jdbcTemplate.query(sql, (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            double avgLatency = rs.getDouble("avg_latency");
            double errorRate = rs.getDouble("error_rate");

            row.put("api_id", rs.getObject("api_id", UUID.class));
            row.put("avg_latency", avgLatency);
            row.put("error_rate", errorRate);

            List<String> violations = new ArrayList<>();
            if (avgLatency > 1000) violations.add("High latency (>" + "1000ms)");
            if (errorRate > 5) violations.add("High error rate (>5%)");
            row.put("violation", String.join(", ", violations));

            return row;
        });
    }

    // ── ReportBuilderController ─────────────────────────────────────────

    @Override
    public List<Map<String, Object>> executeReportQuery(List<String> selectClauses,
            List<String> groupByClauses, String whereClause, List<Object> params, int limit) {

        StringBuilder sql = new StringBuilder("SELECT ");
        sql.append(String.join(", ", selectClauses));
        sql.append(" FROM analytics.request_logs WHERE ");
        sql.append(whereClause != null ? whereClause : "1=1");

        if (groupByClauses != null && !groupByClauses.isEmpty()) {
            sql.append(" GROUP BY ").append(String.join(", ", groupByClauses));
        }

        // Default ordering
        if (groupByClauses != null && !groupByClauses.isEmpty()) {
            if (selectClauses.stream().anyMatch(s -> s.contains("request_count"))) {
                sql.append(" ORDER BY request_count DESC");
            }
        }

        sql.append(" LIMIT ").append(limit > 0 ? limit : 1000);

        log.debug("Executing report query: {}", sql);

        if (params != null && !params.isEmpty()) {
            return jdbcTemplate.queryForList(sql.toString(), params.toArray());
        }
        return jdbcTemplate.queryForList(sql.toString());
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

    private double toSeconds(String interval) {
        if (interval == null) return 86400;
        // Handle raw interval strings like "24 hours", "7 days"
        String lower = interval.toLowerCase().trim();
        if (lower.endsWith("hour") || lower.endsWith("hours")) {
            String num = lower.split("\\s+")[0];
            return Double.parseDouble(num) * 3600;
        } else if (lower.endsWith("day") || lower.endsWith("days")) {
            String num = lower.split("\\s+")[0];
            return Double.parseDouble(num) * 86400;
        } else if (lower.endsWith("minute") || lower.endsWith("minutes")) {
            String num = lower.split("\\s+")[0];
            return Double.parseDouble(num) * 60;
        }
        // Handle shorthand
        return switch (lower) {
            case "1h" -> 3600;
            case "6h" -> 21600;
            case "24h" -> 86400;
            case "7d" -> 604800;
            case "30d" -> 2592000;
            default -> 86400;
        };
    }

    private double toDouble(Object value) {
        if (value == null) return 0.0;
        return Math.round(((Number) value).doubleValue() * 100.0) / 100.0;
    }
}

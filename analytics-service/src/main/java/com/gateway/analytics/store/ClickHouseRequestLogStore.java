package com.gateway.analytics.store;

import com.gateway.analytics.dto.*;
import com.gateway.analytics.entity.RequestLogEntity;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

@Slf4j
@Service
@Profile("clickhouse")
public class ClickHouseRequestLogStore implements RequestLogStore {

    private final JdbcTemplate jdbcTemplate;

    public ClickHouseRequestLogStore(@Qualifier("clickHouseJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    // ── Ingest ──────────────────────────────────────────────────────────

    @Override
    public void save(RequestLogEntity entity) {
        String sql = """
            INSERT INTO gateway_analytics.request_logs
                (trace_id, api_id, route_id, consumer_id, application_id,
                 api_name, consumer_email,
                 method, path, status_code, latency_ms, request_size, response_size,
                 auth_type, client_ip, user_agent, error_code, gateway_node, mock_mode, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;

        jdbcTemplate.update(sql,
                entity.getTraceId(),
                entity.getApiId() != null ? entity.getApiId().toString() : null,
                entity.getRouteId() != null ? entity.getRouteId().toString() : null,
                entity.getConsumerId() != null ? entity.getConsumerId().toString() : null,
                entity.getApplicationId() != null ? entity.getApplicationId().toString() : null,
                entity.getApiName(),
                entity.getConsumerEmail(),
                entity.getMethod(),
                entity.getPath(),
                entity.getStatusCode(),
                entity.getLatencyMs(),
                entity.getRequestSize(),
                entity.getResponseSize(),
                entity.getAuthType(),
                entity.getClientIp(),
                entity.getUserAgent(),
                entity.getErrorCode(),
                entity.getGatewayNode(),
                entity.isMockMode() ? 1 : 0,
                entity.getCreatedAt() != null ? entity.getCreatedAt() : Instant.now());
    }

    // ── DashboardService ────────────────────────────────────────────────

    @Override
    public DashboardResponse getDashboardStats(String interval) {
        String sql = """
            SELECT
                count() AS total_requests,
                ifNull(avg(latency_ms), 0) AS avg_latency,
                ifNull(
                    countIf(status_code >= 400) * 100.0 / if(count() = 0, 1, count()),
                    0
                ) AS error_rate,
                count(DISTINCT api_id) AS active_apis
            FROM gateway_analytics.request_logs
            WHERE created_at >= now() - INTERVAL %s
            """.formatted(toClickHouseInterval(interval));

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
        String sql = """
            SELECT
                concat(toString(intDiv(status_code, 100)), 'xx') AS status_group,
                count() AS cnt
            FROM gateway_analytics.request_logs
            WHERE created_at >= now() - INTERVAL %s
            GROUP BY intDiv(status_code, 100)
            ORDER BY status_group
            """.formatted(toClickHouseInterval(interval));

        Map<String, Long> statusCodeBreakdown = new LinkedHashMap<>();
        jdbcTemplate.query(sql, (rs, rowNum) -> {
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
                api_id,
                ifNull(api_name, toString(api_id)) AS api_name,
                count() AS request_count,
                countIf(status_code >= 400) AS error_count,
                ifNull(avg(latency_ms), 0) AS avg_latency,
                ifNull(
                    countIf(status_code >= 400) * 100.0 / if(count() = 0, 1, count()),
                    0
                ) AS error_rate
            FROM gateway_analytics.request_logs
            WHERE created_at >= now() - INTERVAL %s
            GROUP BY api_id, api_name
            ORDER BY %s
            LIMIT ?
            """.formatted(toClickHouseInterval(interval), orderBy);

        return jdbcTemplate.query(sql, (rs, rowNum) -> TopApiEntry.builder()
                .apiId(UUID.fromString(rs.getString("api_id")))
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
                consumer_id,
                ifNull(consumer_email, toString(consumer_id)) AS consumer_name,
                count() AS request_count,
                countIf(status_code >= 400) AS error_count,
                ifNull(avg(latency_ms), 0) AS avg_latency
            FROM gateway_analytics.request_logs
            WHERE consumer_id IS NOT NULL
              AND created_at >= now() - INTERVAL %s
            GROUP BY consumer_id, consumer_email
            ORDER BY request_count DESC
            LIMIT ?
            """.formatted(toClickHouseInterval(interval));

        return jdbcTemplate.query(sql, (rs, rowNum) -> TopConsumerEntry.builder()
                .consumerId(UUID.fromString(rs.getString("consumer_id")))
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
                quantile(0.5)(latency_ms)  AS p50,
                quantile(0.75)(latency_ms) AS p75,
                quantile(0.9)(latency_ms)  AS p90,
                quantile(0.95)(latency_ms) AS p95,
                quantile(0.99)(latency_ms) AS p99
            FROM gateway_analytics.request_logs
            WHERE created_at >= now() - INTERVAL %s
            """.formatted(toClickHouseInterval(interval));

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

        String placeholders = String.join(",", apiIds.stream().map(id -> "?").toList());

        String sql = """
            SELECT
                api_id,
                count() AS total_requests,
                ifNull(avg(latency_ms), 0) AS avg_latency,
                ifNull(quantile(0.50)(latency_ms), 0) AS p50_latency,
                ifNull(quantile(0.95)(latency_ms), 0) AS p95_latency,
                ifNull(quantile(0.99)(latency_ms), 0) AS p99_latency,
                ifNull(
                    countIf(status_code >= 400) * 100.0 / if(count() = 0, 1, count()),
                    0
                ) AS error_rate
            FROM gateway_analytics.request_logs
            WHERE api_id IN (%s)
              AND created_at >= now() - INTERVAL %s
            GROUP BY api_id
            ORDER BY total_requests DESC
            """.formatted(placeholders, toClickHouseInterval(interval));

        Object[] params = apiIds.stream().map(UUID::toString).toArray();

        return jdbcTemplate.query(sql, (rs, rowNum) -> {
            long totalRequests = rs.getLong("total_requests");
            double throughputRps = intervalSeconds > 0 ? totalRequests / intervalSeconds : 0;

            return ApiComparisonEntry.builder()
                    .apiId(UUID.fromString(rs.getString("api_id")))
                    .apiName(null)
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
                count() AS total_requests,
                countIf(status_code >= 400) AS total_errors,
                ifNull(avg(latency_ms), 0) AS avg_latency,
                ifNull(max(latency_ms), 0) AS max_latency,
                ifNull(
                    countIf(status_code >= 400) * 100.0 / if(count() = 0, 1, count()),
                    0
                ) AS error_rate
            FROM gateway_analytics.request_logs
            WHERE api_id = ?
              AND created_at >= now() - INTERVAL %s
            """.formatted(toClickHouseInterval(interval));

        Map<String, Object> stats = jdbcTemplate.queryForMap(sql, apiId.toString());

        // Status code breakdown for this API
        String breakdownSql = """
            SELECT
                concat(toString(intDiv(status_code, 100)), 'xx') AS status_group,
                count() AS cnt
            FROM gateway_analytics.request_logs
            WHERE api_id = ?
              AND created_at >= now() - INTERVAL %s
            GROUP BY intDiv(status_code, 100)
            ORDER BY status_group
            """.formatted(toClickHouseInterval(interval));

        Map<String, Long> statusCodeBreakdown = new LinkedHashMap<>();
        jdbcTemplate.query(breakdownSql, (rs, rowNum) -> {
            statusCodeBreakdown.put(rs.getString("status_group"), rs.getLong("cnt"));
            return null;
        }, apiId.toString());

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
                count() AS total,
                ifNull(
                    countIf(status_code >= 400) * 100.0 / if(count() = 0, 1, count()),
                    0
                ) AS error_rate,
                ifNull(avg(latency_ms), 0) AS avg_latency
            FROM gateway_analytics.request_logs
            WHERE created_at >= now() - INTERVAL 1 MINUTE
            """;

        Map<String, Object> row = jdbcTemplate.queryForMap(sql);
        long total = ((Number) row.get("total")).longValue();
        double errorRate = ((Number) row.get("error_rate")).doubleValue();
        double avgLatency = ((Number) row.get("avg_latency")).doubleValue();

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
                count() AS cnt,
                max(created_at) AS last_seen
            FROM gateway_analytics.request_logs
            WHERE status_code >= 400
              AND created_at >= now() - INTERVAL 1 HOUR
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
        String chInterval = windowMinutes + " MINUTE";
        String apiFilter = apiId != null ? " AND api_id = '" + apiId + "'" : "";

        String sql = switch (metric.toLowerCase()) {
            case "error_rate" -> """
                SELECT ifNull(
                    countIf(status_code >= 400) * 100.0 / if(count() = 0, 1, count()),
                    0
                ) AS value
                FROM gateway_analytics.request_logs
                WHERE created_at >= now() - INTERVAL %s AND (mock_mode = 0 OR mock_mode IS NULL)%s
                """.formatted(chInterval, apiFilter);

            case "avg_latency" -> """
                SELECT ifNull(avg(latency_ms), 0) AS value
                FROM gateway_analytics.request_logs
                WHERE created_at >= now() - INTERVAL %s AND (mock_mode = 0 OR mock_mode IS NULL)%s
                """.formatted(chInterval, apiFilter);

            case "request_count", "requests_per_min" -> """
                SELECT count() AS value
                FROM gateway_analytics.request_logs
                WHERE created_at >= now() - INTERVAL %s AND (mock_mode = 0 OR mock_mode IS NULL)%s
                """.formatted(chInterval, apiFilter);

            case "p99_latency", "latency_p99" -> """
                SELECT ifNull(quantile(0.99)(latency_ms), 0) AS value
                FROM gateway_analytics.request_logs
                WHERE created_at >= now() - INTERVAL %s AND (mock_mode = 0 OR mock_mode IS NULL)%s
                """.formatted(chInterval, apiFilter);

            case "uptime" -> """
                SELECT ifNull(
                    countIf(status_code < 500) * 100.0 / if(count() = 0, 1, count()),
                    100
                ) AS value
                FROM gateway_analytics.request_logs
                WHERE created_at >= now() - INTERVAL %s
                  AND (mock_mode = 0 OR mock_mode IS NULL)%s
                """.formatted(chInterval, apiFilter);

            case "latency_p95" -> """
                SELECT ifNull(quantile(0.95)(latency_ms), 0) AS value
                FROM gateway_analytics.request_logs
                WHERE created_at >= now() - INTERVAL %s
                  AND (mock_mode = 0 OR mock_mode IS NULL)%s
                """.formatted(chInterval, apiFilter);

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
                count() AS total_requests,
                ifNull(avg(latency_ms), 0) AS avg_latency,
                ifNull(quantile(0.99)(latency_ms), 0) AS p99_latency,
                ifNull(
                    countIf(status_code >= 400) * 100.0 / if(count() = 0, 1, count()),
                    0
                ) AS error_rate,
                dateDiff('second', min(created_at), now()) AS window_seconds
            FROM gateway_analytics.request_logs
            WHERE created_at >= now() - INTERVAL 60 SECOND
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
                count() AS total_requests,
                ifNull(avg(latency_ms), 0) AS avg_latency,
                ifNull(
                    countIf(status_code >= 400) * 100.0 / if(count() = 0, 1, count()),
                    0
                ) AS error_rate
            FROM gateway_analytics.request_logs
            WHERE created_at >= now() - INTERVAL %s
            """.formatted(toClickHouseInterval(interval));
        return jdbcTemplate.queryForMap(sql);
    }

    @Override
    public List<Map<String, Object>> getReportTopApis(String interval, int limit) {
        String sql = """
            SELECT
                api_id,
                count() AS request_count,
                countIf(status_code >= 400) AS error_count,
                ifNull(avg(latency_ms), 0) AS avg_latency,
                ifNull(
                    countIf(status_code >= 400) * 100.0 / if(count() = 0, 1, count()),
                    0
                ) AS error_rate
            FROM gateway_analytics.request_logs
            WHERE created_at >= now() - INTERVAL %s
            GROUP BY api_id
            ORDER BY request_count DESC
            LIMIT ?
            """.formatted(toClickHouseInterval(interval));

        return jdbcTemplate.query(sql, (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("api_id", UUID.fromString(rs.getString("api_id")));
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
                ifNull(error_code, 'UNKNOWN') AS error_code,
                count() AS cnt
            FROM gateway_analytics.request_logs
            WHERE status_code >= 400
              AND created_at >= now() - INTERVAL %s
            GROUP BY status_code, error_code
            ORDER BY cnt DESC
            LIMIT ?
            """.formatted(toClickHouseInterval(interval));

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
                ifNull(avg(latency_ms), 0) AS avg_latency,
                ifNull(
                    countIf(status_code >= 400) * 100.0 / if(count() = 0, 1, count()),
                    0
                ) AS error_rate
            FROM gateway_analytics.request_logs
            WHERE created_at >= now() - INTERVAL %s
            GROUP BY api_id
            HAVING avg(latency_ms) > 1000
               OR (countIf(status_code >= 400) * 100.0 / if(count() = 0, 1, count())) > 5
            """.formatted(toClickHouseInterval(interval));

        return jdbcTemplate.query(sql, (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            double avgLatency = rs.getDouble("avg_latency");
            double errorRate = rs.getDouble("error_rate");

            row.put("api_id", UUID.fromString(rs.getString("api_id")));
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

        // Translate PostgreSQL time functions to ClickHouse equivalents
        List<String> translatedSelect = selectClauses.stream()
                .map(this::translateToClickHouse)
                .toList();
        List<String> translatedGroupBy = groupByClauses != null
                ? groupByClauses.stream().map(this::translateToClickHouse).toList()
                : List.of();

        StringBuilder sql = new StringBuilder("SELECT ");
        sql.append(String.join(", ", translatedSelect));
        sql.append(" FROM gateway_analytics.request_logs WHERE ");
        sql.append(whereClause != null ? translateToClickHouse(whereClause) : "1=1");

        if (!translatedGroupBy.isEmpty()) {
            sql.append(" GROUP BY ").append(String.join(", ", translatedGroupBy));
        }

        if (!translatedGroupBy.isEmpty()) {
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

    /**
     * Convert a PostgreSQL interval string like "24 hours" or "7 days" into
     * ClickHouse INTERVAL syntax like "24 HOUR" or "7 DAY".
     */
    private String toClickHouseInterval(String pgInterval) {
        if (pgInterval == null) return "24 HOUR";
        String lower = pgInterval.toLowerCase().trim();

        if (lower.endsWith("hours") || lower.endsWith("hour")) {
            String num = lower.split("\\s+")[0];
            return num + " HOUR";
        } else if (lower.endsWith("days") || lower.endsWith("day")) {
            String num = lower.split("\\s+")[0];
            return num + " DAY";
        } else if (lower.endsWith("minutes") || lower.endsWith("minute")) {
            String num = lower.split("\\s+")[0];
            return num + " MINUTE";
        } else if (lower.endsWith("seconds") || lower.endsWith("second")) {
            String num = lower.split("\\s+")[0];
            return num + " SECOND";
        } else if (lower.endsWith("weeks") || lower.endsWith("week")) {
            String num = lower.split("\\s+")[0];
            return num + " WEEK";
        } else if (lower.endsWith("months") || lower.endsWith("month")) {
            String num = lower.split("\\s+")[0];
            return num + " MONTH";
        }

        // Handle shorthand
        return switch (lower) {
            case "1h" -> "1 HOUR";
            case "6h" -> "6 HOUR";
            case "24h" -> "24 HOUR";
            case "7d" -> "7 DAY";
            case "30d" -> "30 DAY";
            default -> "24 HOUR";
        };
    }

    /**
     * Translate PostgreSQL SQL fragments to ClickHouse equivalents for dynamic report queries.
     */
    private String translateToClickHouse(String clause) {
        if (clause == null) return null;
        String result = clause;

        // DATE_TRUNC translations
        result = result.replaceAll("(?i)DATE_TRUNC\\s*\\(\\s*'hour'\\s*,\\s*([^)]+)\\)", "toStartOfHour($1)");
        result = result.replaceAll("(?i)DATE_TRUNC\\s*\\(\\s*'minute'\\s*,\\s*([^)]+)\\)", "toStartOfMinute($1)");
        result = result.replaceAll("(?i)DATE_TRUNC\\s*\\(\\s*'day'\\s*,\\s*([^)]+)\\)", "toStartOfDay($1)");
        result = result.replaceAll("(?i)DATE_TRUNC\\s*\\(\\s*'week'\\s*,\\s*([^)]+)\\)", "toStartOfWeek($1)");
        result = result.replaceAll("(?i)DATE_TRUNC\\s*\\(\\s*'month'\\s*,\\s*([^)]+)\\)", "toStartOfMonth($1)");

        // COUNT(*) FILTER (WHERE cond) -> countIf(cond)
        result = result.replaceAll("(?i)COUNT\\s*\\(\\s*\\*\\s*\\)\\s+FILTER\\s*\\(\\s*WHERE\\s+([^)]+)\\)", "countIf($1)");

        // PERCENTILE_CONT(p) WITHIN GROUP (ORDER BY col) -> quantile(p)(col)
        result = result.replaceAll(
                "(?i)PERCENTILE_CONT\\s*\\(([^)]+)\\)\\s+WITHIN\\s+GROUP\\s*\\(\\s*ORDER\\s+BY\\s+([^)]+)\\)",
                "quantile($1)($2)");

        // NULLIF(COUNT(*), 0) -> if(count() = 0, 1, count())
        result = result.replaceAll("(?i)NULLIF\\s*\\(\\s*COUNT\\s*\\(\\s*\\*\\s*\\)\\s*,\\s*0\\s*\\)",
                "if(count() = 0, 1, count())");

        // CAST(x / 100 AS TEXT) || 'xx' -> concat(toString(intDiv(x, 100)), 'xx')
        result = result.replaceAll(
                "(?i)CAST\\s*\\(\\s*(\\w+)\\s*/\\s*100\\s+AS\\s+TEXT\\s*\\)\\s*\\|\\|\\s*'xx'",
                "concat(toString(intDiv($1, 100)), 'xx')");

        // schema.table -> database.table
        result = result.replaceAll("(?i)analytics\\.request_logs", "gateway_analytics.request_logs");

        // COALESCE -> ifNull
        result = result.replaceAll("(?i)COALESCE\\s*\\(", "ifNull(");

        // NOW() -> now()
        result = result.replaceAll("(?i)NOW\\s*\\(\\s*\\)", "now()");

        return result;
    }

    private double toSeconds(String interval) {
        if (interval == null) return 86400;
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

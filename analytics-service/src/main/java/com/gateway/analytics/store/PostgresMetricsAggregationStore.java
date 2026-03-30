package com.gateway.analytics.store;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@Profile("!clickhouse")
@Primary
public class PostgresMetricsAggregationStore implements MetricsAggregationStore {

    private final JdbcTemplate jdbcTemplate;

    public PostgresMetricsAggregationStore(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void aggregateToMinute() {
        log.debug("Postgres: starting minute-level metrics aggregation");
        int rows = jdbcTemplate.update("""
                INSERT INTO analytics.metrics_1m (api_id, window_start, request_count, error_count,
                    latency_sum_ms, latency_max_ms, bytes_in, bytes_out)
                SELECT
                    api_id,
                    date_trunc('minute', created_at) AS window_start,
                    COUNT(*) AS request_count,
                    COUNT(*) FILTER (WHERE status_code >= 400) AS error_count,
                    COALESCE(SUM(latency_ms), 0) AS latency_sum_ms,
                    COALESCE(MAX(latency_ms), 0) AS latency_max_ms,
                    COALESCE(SUM(request_size), 0) AS bytes_in,
                    COALESCE(SUM(response_size), 0) AS bytes_out
                FROM analytics.request_logs
                WHERE created_at >= date_trunc('minute', NOW() - INTERVAL '2 minutes')
                  AND created_at < date_trunc('minute', NOW())
                GROUP BY api_id, date_trunc('minute', created_at)
                ON CONFLICT ON CONSTRAINT uq_metrics1m
                DO UPDATE SET
                    request_count = EXCLUDED.request_count,
                    error_count = EXCLUDED.error_count,
                    latency_sum_ms = EXCLUDED.latency_sum_ms,
                    latency_max_ms = EXCLUDED.latency_max_ms,
                    bytes_in = EXCLUDED.bytes_in,
                    bytes_out = EXCLUDED.bytes_out
                """);
        log.debug("Postgres: minute aggregation complete: {} rows upserted", rows);
    }

    @Override
    public void aggregateToHour() {
        log.debug("Postgres: starting hour-level metrics aggregation");
        int rows = jdbcTemplate.update("""
                INSERT INTO analytics.metrics_1h (api_id, window_start, request_count, error_count,
                    latency_sum_ms, latency_max_ms)
                SELECT
                    api_id,
                    date_trunc('hour', window_start) AS window_start,
                    SUM(request_count) AS request_count,
                    SUM(error_count) AS error_count,
                    SUM(latency_sum_ms) AS latency_sum_ms,
                    MAX(latency_max_ms) AS latency_max_ms
                FROM analytics.metrics_1m
                WHERE window_start >= date_trunc('hour', NOW() - INTERVAL '2 hours')
                  AND window_start < date_trunc('hour', NOW())
                GROUP BY api_id, date_trunc('hour', window_start)
                ON CONFLICT ON CONSTRAINT uq_metrics1h
                DO UPDATE SET
                    request_count = EXCLUDED.request_count,
                    error_count = EXCLUDED.error_count,
                    latency_sum_ms = EXCLUDED.latency_sum_ms,
                    latency_max_ms = EXCLUDED.latency_max_ms
                """);
        log.debug("Postgres: hour aggregation complete: {} rows upserted", rows);
    }

    @Override
    public void aggregateToDay() {
        log.debug("Postgres: starting day-level metrics aggregation");
        int rows = jdbcTemplate.update("""
                INSERT INTO analytics.metrics_1d (api_id, window_start, request_count, error_count,
                    latency_sum_ms, latency_max_ms)
                SELECT
                    api_id,
                    date_trunc('day', window_start)::date AS window_start,
                    SUM(request_count) AS request_count,
                    SUM(error_count) AS error_count,
                    SUM(latency_sum_ms) AS latency_sum_ms,
                    MAX(latency_max_ms) AS latency_max_ms
                FROM analytics.metrics_1h
                WHERE window_start >= date_trunc('day', NOW() - INTERVAL '2 days')
                  AND window_start < date_trunc('day', NOW())
                GROUP BY api_id, date_trunc('day', window_start)
                ON CONFLICT ON CONSTRAINT uq_metrics1d
                DO UPDATE SET
                    request_count = EXCLUDED.request_count,
                    error_count = EXCLUDED.error_count,
                    latency_sum_ms = EXCLUDED.latency_sum_ms,
                    latency_max_ms = EXCLUDED.latency_max_ms
                """);
        log.debug("Postgres: day aggregation complete: {} rows upserted", rows);
    }
}

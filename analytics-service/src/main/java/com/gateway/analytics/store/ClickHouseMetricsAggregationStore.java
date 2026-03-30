package com.gateway.analytics.store;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@Profile("clickhouse")
public class ClickHouseMetricsAggregationStore implements MetricsAggregationStore {

    private final JdbcTemplate clickHouseJdbcTemplate;

    public ClickHouseMetricsAggregationStore(
            @Qualifier("clickHouseJdbcTemplate") JdbcTemplate clickHouseJdbcTemplate) {
        this.clickHouseJdbcTemplate = clickHouseJdbcTemplate;
    }

    @Override
    public void aggregateToMinute() {
        log.debug("ClickHouse: starting minute-level metrics aggregation");
        int rows = clickHouseJdbcTemplate.update("""
                INSERT INTO gateway_analytics.metrics_1m (api_id, window_start, request_count, error_count,
                    latency_sum_ms, latency_max_ms, bytes_in, bytes_out)
                SELECT
                    api_id,
                    toStartOfMinute(created_at) AS window_start,
                    COUNT(*) AS request_count,
                    countIf(status_code >= 400) AS error_count,
                    COALESCE(SUM(latency_ms), 0) AS latency_sum_ms,
                    COALESCE(MAX(latency_ms), 0) AS latency_max_ms,
                    COALESCE(SUM(request_size), 0) AS bytes_in,
                    COALESCE(SUM(response_size), 0) AS bytes_out
                FROM gateway_analytics.request_logs
                WHERE created_at >= toStartOfMinute(now() - INTERVAL 2 MINUTE)
                  AND created_at < toStartOfMinute(now())
                GROUP BY api_id, toStartOfMinute(created_at)
                """);
        log.debug("ClickHouse: minute aggregation complete: {} rows inserted", rows);
    }

    @Override
    public void aggregateToHour() {
        log.debug("ClickHouse: starting hour-level metrics aggregation");
        int rows = clickHouseJdbcTemplate.update("""
                INSERT INTO gateway_analytics.metrics_1h (api_id, window_start, request_count, error_count,
                    latency_sum_ms, latency_max_ms)
                SELECT
                    api_id,
                    toStartOfHour(window_start) AS window_start,
                    SUM(request_count) AS request_count,
                    SUM(error_count) AS error_count,
                    SUM(latency_sum_ms) AS latency_sum_ms,
                    MAX(latency_max_ms) AS latency_max_ms
                FROM gateway_analytics.metrics_1m
                WHERE window_start >= toStartOfHour(now() - INTERVAL 2 HOUR)
                  AND window_start < toStartOfHour(now())
                GROUP BY api_id, toStartOfHour(window_start)
                """);
        log.debug("ClickHouse: hour aggregation complete: {} rows inserted", rows);
    }

    @Override
    public void aggregateToDay() {
        log.debug("ClickHouse: starting day-level metrics aggregation");
        int rows = clickHouseJdbcTemplate.update("""
                INSERT INTO gateway_analytics.metrics_1d (api_id, window_start, request_count, error_count,
                    latency_sum_ms, latency_max_ms)
                SELECT
                    api_id,
                    toDate(toStartOfDay(window_start)) AS window_start,
                    SUM(request_count) AS request_count,
                    SUM(error_count) AS error_count,
                    SUM(latency_sum_ms) AS latency_sum_ms,
                    MAX(latency_max_ms) AS latency_max_ms
                FROM gateway_analytics.metrics_1h
                WHERE window_start >= toStartOfDay(now() - INTERVAL 2 DAY)
                  AND window_start < toStartOfDay(now())
                GROUP BY api_id, toStartOfDay(window_start)
                """);
        log.debug("ClickHouse: day aggregation complete: {} rows inserted", rows);
    }
}

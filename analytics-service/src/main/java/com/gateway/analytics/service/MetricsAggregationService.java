package com.gateway.analytics.service;

import com.gateway.analytics.store.MetricsAggregationStore;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Periodically aggregates request_logs into rollup metrics tables:
 * <ul>
 *   <li>Every minute: request_logs → metrics_1m</li>
 *   <li>Every hour: metrics_1m → metrics_1h</li>
 *   <li>Every day: metrics_1h → metrics_1d</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MetricsAggregationService {

    private final MetricsAggregationStore store;

    @Scheduled(fixedRate = 60000)
    public void aggregateToMinute() { store.aggregateToMinute(); }

    @Scheduled(cron = "0 0 * * * *")
    public void aggregateToHour() { store.aggregateToHour(); }

    @Scheduled(cron = "0 0 0 * * *")
    public void aggregateToDay() { store.aggregateToDay(); }
}

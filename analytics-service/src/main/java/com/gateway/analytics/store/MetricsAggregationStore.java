package com.gateway.analytics.store;

public interface MetricsAggregationStore {
    void aggregateToMinute();
    void aggregateToHour();
    void aggregateToDay();
}

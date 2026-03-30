package com.gateway.analytics.store;

import com.gateway.analytics.dto.*;
import com.gateway.analytics.entity.RequestLogEntity;
import java.math.BigDecimal;
import java.util.*;

public interface RequestLogStore {
    // Ingest
    void save(RequestLogEntity entity);

    // DashboardService
    DashboardResponse getDashboardStats(String interval);
    Map<String, Long> getStatusCodeBreakdown(String interval);
    List<TopApiEntry> getTopApis(int limit, String metric, String interval);
    List<TopConsumerEntry> getTopConsumers(int limit, String interval);
    Map<String, Double> getPercentiles(String interval);
    List<ApiComparisonEntry> compareApis(List<UUID> apiIds, String interval);
    ApiMetricsResponse getApiMetrics(UUID apiId, String interval);

    // HealthDashboardService
    Map<String, Object> getGatewayStats();  // returns rps, errorRate, avgLatency
    List<Map<String, Object>> getTopErrors(); // status_code, count, last_seen

    // AlertingService + SlaMonitoringService
    BigDecimal queryMetric(String metric, int windowMinutes, UUID apiId);

    // MetricsStreamController
    Map<String, Object> getRealtimeMetrics(); // last 60 seconds

    // ReportSchedulerService
    Map<String, Object> getReportSummary(String interval);
    List<Map<String, Object>> getReportTopApis(String interval, int limit);
    List<Map<String, Object>> getReportTopErrors(String interval, int limit);
    List<Map<String, Object>> getReportSlaViolations(String interval);

    // ReportBuilderController
    List<Map<String, Object>> executeReportQuery(List<String> selectClauses,
        List<String> groupByClauses, String whereClause, List<Object> params, int limit);
}

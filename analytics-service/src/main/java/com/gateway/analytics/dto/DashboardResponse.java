package com.gateway.analytics.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DashboardResponse {

    private long totalRequests;
    private double avgLatencyMs;
    private double avgLatency;  // alias for frontend compatibility
    private double avgUpstreamLatencyMs;
    private double avgGatewayLatencyMs;
    private double errorRate;
    private long activeApis;
    private Map<String, Long> statusCodeBreakdown;
}

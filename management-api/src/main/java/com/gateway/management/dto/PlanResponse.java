package com.gateway.management.dto;

import com.gateway.management.entity.enums.Enforcement;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PlanResponse {

    private UUID id;
    private String name;
    private String description;
    private Integer requestsPerSecond;
    private Integer requestsPerMinute;
    private Integer requestsPerDay;
    private Integer burstAllowance;
    private Long maxRequestsPerMonth;
    private Enforcement enforcement;
    private String status;

    // ── Pricing fields ───────────────────────────────────────────────────
    private String pricingModel;
    private BigDecimal priceAmount;
    private String currency;
    private String billingPeriod;
    private Long includedRequests;
    private BigDecimal overageRate;

    private DunningConfig dunningConfig;

    private Instant createdAt;
    private Instant updatedAt;
}

package com.gateway.management.dto;

import com.gateway.management.entity.enums.Enforcement;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreatePlanRequest {

    @NotBlank(message = "Plan name is required")
    private String name;

    private String description;

    private RateLimitsConfig rateLimits;

    private QuotaConfig quota;

    private Enforcement enforcement;

    // ── Pricing fields ───────────────────────────────────────────────────
    private String pricingModel;
    private BigDecimal priceAmount;
    private String currency;
    private String billingPeriod;
    private Long includedRequests;
    private BigDecimal overageRate;

    private DunningConfig dunningConfig;
}

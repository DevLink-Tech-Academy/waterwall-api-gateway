package com.gateway.management.entity;

import com.gateway.management.entity.enums.Enforcement;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "plans", schema = "gateway")
public class PlanEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @Column(name = "name", nullable = false, unique = true, length = 100)
    private String name;

    @Column(name = "description", columnDefinition = "text")
    private String description;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "rate_limits", columnDefinition = "jsonb")
    private String rateLimits;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "quota", columnDefinition = "jsonb")
    private String quota;

    @Enumerated(EnumType.STRING)
    @Column(name = "enforcement", length = 10)
    private Enforcement enforcement;

    @Column(name = "status", length = 20)
    private String status;

    // ── Pricing columns (merged from pricing_plans) ──────────────────────

    @Column(name = "pricing_model", length = 50)
    private String pricingModel;

    @Column(name = "price_amount", precision = 12, scale = 2)
    private BigDecimal priceAmount;

    @Column(name = "currency", length = 10)
    private String currency;

    @Column(name = "billing_period", length = 50)
    private String billingPeriod;

    @Column(name = "included_requests")
    private Long includedRequests;

    @Column(name = "overage_rate", precision = 10, scale = 6)
    private BigDecimal overageRate;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "dunning_config", columnDefinition = "jsonb")
    private String dunningConfig;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;
}

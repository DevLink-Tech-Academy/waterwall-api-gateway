package com.gateway.management.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "wallets", schema = "gateway")
public class WalletEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @Column(name = "consumer_id", nullable = false, unique = true)
    private UUID consumerId;

    @Builder.Default
    @Column(name = "balance", nullable = false, precision = 12, scale = 2)
    private BigDecimal balance = BigDecimal.ZERO;

    @Column(name = "currency", length = 10)
    private String currency;

    @Builder.Default
    @Column(name = "auto_top_up_enabled")
    private Boolean autoTopUpEnabled = false;

    @Column(name = "auto_top_up_threshold", precision = 12, scale = 2)
    private BigDecimal autoTopUpThreshold;

    @Column(name = "auto_top_up_amount", precision = 12, scale = 2)
    private BigDecimal autoTopUpAmount;

    @Column(name = "low_balance_threshold", precision = 12, scale = 2)
    private BigDecimal lowBalanceThreshold;

    @Column(name = "pending_topup_amount", precision = 12, scale = 2)
    private BigDecimal pendingTopupAmount;

    @Column(name = "pending_topup_reference", length = 255)
    private String pendingTopupReference;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;
}

package com.gateway.analytics.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "request_logs", schema = "analytics")
public class RequestLogEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "trace_id", length = 100)
    private String traceId;

    @Column(name = "api_id")
    private UUID apiId;

    @Column(name = "route_id")
    private UUID routeId;

    @Column(name = "consumer_id")
    private UUID consumerId;

    @Column(name = "application_id")
    private UUID applicationId;

    @Column(name = "api_name")
    private String apiName;

    @Column(name = "consumer_email")
    private String consumerEmail;

    @Column(name = "method", length = 10)
    private String method;

    @Column(name = "path", length = 500)
    private String path;

    @Column(name = "status_code")
    private int statusCode;

    @Column(name = "latency_ms")
    private int latencyMs;

    @Column(name = "request_size")
    private long requestSize;

    @Column(name = "response_size")
    private long responseSize;

    @Column(name = "auth_type", length = 20)
    private String authType;

    @Column(name = "client_ip", length = 45)
    private String clientIp;

    @Column(name = "user_agent", length = 500)
    private String userAgent;

    @Column(name = "error_code", length = 20)
    private String errorCode;

    @Column(name = "gateway_node", length = 100)
    private String gatewayNode;

    @Column(name = "mock_mode")
    private boolean mockMode;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

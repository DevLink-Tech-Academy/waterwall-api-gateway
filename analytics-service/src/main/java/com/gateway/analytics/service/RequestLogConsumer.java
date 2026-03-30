package com.gateway.analytics.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.analytics.entity.RequestLogEntity;
import com.gateway.analytics.repository.RequestLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.Exchange;
import org.springframework.amqp.rabbit.annotation.Queue;
import org.springframework.amqp.rabbit.annotation.QueueBinding;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Consumes access-log events published by the gateway runtime on the
 * {@code analytics.ingest} topic exchange with routing key {@code request.logged},
 * and persists them into the {@code analytics.request_logs} table.
 *
 * @see com.gateway.runtime.service.AccessLogService.AccessLogEvent
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RequestLogConsumer {

    private final RequestLogRepository requestLogRepository;
    private final com.gateway.analytics.store.RequestLogStore requestLogStore;
    private final ObjectMapper objectMapper;

    @Transactional
    @RabbitListener(bindings = @QueueBinding(
            value = @Queue(value = "analytics-service.request-logs", durable = "true"),
            exchange = @Exchange(value = "analytics.ingest", type = "topic"),
            key = "request.logged"
    ))
    public void handleRequestLogged(org.springframework.amqp.core.Message rawMessage) {
        try {
            String message = new String(rawMessage.getBody(), java.nio.charset.StandardCharsets.UTF_8);
            log.info("Received access log event ({} bytes)", rawMessage.getBody().length);
            JsonNode json = objectMapper.readTree(message);

            RequestLogEntity entity = RequestLogEntity.builder()
                    .traceId(textOrNull(json, "traceId"))
                    .apiId(uuidOrNull(json, "apiId"))
                    .routeId(uuidOrNull(json, "routeId"))
                    .consumerId(uuidOrNull(json, "consumerId"))
                    .applicationId(uuidOrNull(json, "applicationId"))
                    .apiName(textOrNull(json, "apiName"))
                    .consumerEmail(textOrNull(json, "consumerEmail"))
                    .method(textOrNull(json, "method"))
                    .path(textOrNull(json, "path"))
                    .statusCode(json.path("statusCode").asInt(0))
                    .latencyMs((int) json.path("latencyMs").asLong(0))
                    .requestSize(json.path("requestSize").asLong(0))
                    .responseSize(json.path("responseSize").asLong(0))
                    .authType(textOrNull(json, "authType"))
                    .clientIp(textOrNull(json, "clientIp"))
                    .userAgent(textOrNull(json, "userAgent"))
                    .errorCode(textOrNull(json, "errorCode"))
                    .gatewayNode(textOrNull(json, "gatewayNode"))
                    .mockMode(json.path("mockMode").asBoolean(false))
                    .build();

            requestLogStore.save(entity);

            log.info("Persisted request log: trace={} {} {} -> {}",
                    entity.getTraceId(), entity.getMethod(),
                    entity.getPath(), entity.getStatusCode());
        } catch (Exception ex) {
            log.error("Failed to process request log event: {}", ex.getMessage(), ex);
        }
    }

    private String textOrNull(JsonNode json, String field) {
        JsonNode node = json.get(field);
        if (node == null || node.isNull() || node.asText().isBlank()) {
            return null;
        }
        return node.asText();
    }

    private UUID uuidOrNull(JsonNode json, String field) {
        String value = textOrNull(json, field);
        if (value == null) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            log.warn("Invalid UUID for field '{}': {}", field, value);
            return null;
        }
    }
}

package com.gateway.notification.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.notification.entity.NotificationEntity;
import com.gateway.notification.repository.NotificationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.UUID;

@Service
public class BillingEventsConsumer {

    private static final Logger log = LoggerFactory.getLogger(BillingEventsConsumer.class);

    private static final Map<String, String> EVENT_TITLE_MAP = Map.of(
            "invoice.generated", "New Invoice",
            "invoice.paid", "Payment Confirmed",
            "payment.failed", "Payment Failed",
            "payment.retry_scheduled", "Payment Retry Scheduled",
            "subscription.grace_period", "Subscription Grace Period",
            "subscription.suspended", "Subscription Suspended",
            "subscription.expired", "Subscription Expired",
            "consumer.alert_triggered", "Alert Triggered"
    );

    private final NotificationRepository notificationRepository;
    private final ObjectMapper objectMapper;

    public BillingEventsConsumer(NotificationRepository notificationRepository, ObjectMapper objectMapper) {
        this.notificationRepository = notificationRepository;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = "notification-service.billing-events")
    @Transactional
    public void handleBillingEvent(String message) {
        try {
            Map<String, Object> event = objectMapper.readValue(message, new TypeReference<>() {});
            String eventType = (String) event.get("eventType");
            String consumerId = (String) event.get("consumerId");
            String invoiceId = (String) event.get("invoiceId");

            if (eventType == null || consumerId == null) {
                log.warn("Billing event missing required fields: {}", message);
                return;
            }

            String title = EVENT_TITLE_MAP.getOrDefault(eventType, "Billing Event");
            String body = buildBody(eventType, invoiceId);

            UUID userId;
            try {
                userId = UUID.fromString(consumerId);
            } catch (IllegalArgumentException e) {
                log.warn("Invalid consumerId in billing event: {}", consumerId);
                return;
            }

            NotificationEntity notification = new NotificationEntity();
            notification.setUserId(userId);
            notification.setTitle(title);
            notification.setBody(body);
            notification.setType("BILLING");
            notification.setRead(false);
            notificationRepository.save(notification);

            log.info("Billing notification created: eventType={} userId={}", eventType, userId);
        } catch (Exception e) {
            log.error("Failed to process billing event: {}", e.getMessage(), e);
        }
    }

    private String buildBody(String eventType, String invoiceId) {
        String ref = invoiceId != null ? " (Invoice: " + invoiceId + ")" : "";
        return switch (eventType) {
            case "invoice.generated" -> "A new invoice has been generated for your account." + ref;
            case "invoice.paid" -> "Your payment has been confirmed." + ref;
            case "payment.failed" -> "We were unable to process your payment. Please update your payment method." + ref;
            case "payment.retry_scheduled" -> "We will retry your payment shortly." + ref;
            case "subscription.grace_period" -> "Your subscription is in a grace period due to unpaid invoices.";
            case "subscription.suspended" -> "Your subscription has been suspended due to non-payment.";
            case "subscription.expired" -> "Your subscription has expired.";
            case "consumer.alert_triggered" -> "One of your usage alert thresholds has been reached.";
            default -> "Billing event: " + eventType;
        };
    }
}

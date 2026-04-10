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

    private static final Map<String, String> EVENT_TITLE_MAP = Map.ofEntries(
            Map.entry("invoice.generated", "New Invoice"),
            Map.entry("invoice.paid", "Payment Confirmed"),
            Map.entry("payment.failed", "Payment Failed"),
            Map.entry("payment.retry_scheduled", "Payment Retry Scheduled"),
            Map.entry("subscription.grace_period", "Subscription Grace Period"),
            Map.entry("subscription.suspended", "Subscription Suspended"),
            Map.entry("subscription.expired", "Subscription Expired"),
            Map.entry("consumer.alert_triggered", "Alert Triggered"),
            Map.entry("wallet.low_balance", "Low Wallet Balance"),
            Map.entry("wallet.auto_topped_up", "Wallet Auto Top-Up")
    );

    private static final Map<String, String> EVENT_EMAIL_TEMPLATE = Map.of(
            "invoice.generated", "invoice-generated",
            "invoice.paid", "payment-success",
            "payment.failed", "payment-failed",
            "subscription.suspended", "subscription-suspended"
    );

    private final NotificationRepository notificationRepository;
    private final EmailService emailService;
    private final ObjectMapper objectMapper;

    public BillingEventsConsumer(NotificationRepository notificationRepository,
                                 EmailService emailService, ObjectMapper objectMapper) {
        this.notificationRepository = notificationRepository;
        this.emailService = emailService;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = "notification-service.billing-events")
    @Transactional
    public void handleBillingEvent(org.springframework.amqp.core.Message rawMessage) {
        try {
            Map<String, Object> event;
            byte[] body = rawMessage.getBody();
            String content = new String(body, java.nio.charset.StandardCharsets.UTF_8);

            // Handle both JSON object messages and plain string messages
            try {
                event = objectMapper.readValue(content, new TypeReference<>() {});
            } catch (Exception parseEx) {
                log.warn("Could not parse billing event as JSON: {}", content);
                return;
            }

            String eventType = event.get("eventType") != null ? event.get("eventType").toString() : null;
            String consumerId = event.get("consumerId") != null ? event.get("consumerId").toString() : null;
            String invoiceId = event.get("invoiceId") != null ? event.get("invoiceId").toString() : null;

            if (eventType == null || consumerId == null) {
                log.warn("Billing event missing required fields: {}", content);
                return;
            }

            String title = EVENT_TITLE_MAP.getOrDefault(eventType, "Billing Event");
            String notificationBody = buildBody(eventType, invoiceId);

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
            notification.setBody(notificationBody);
            notification.setType("BILLING");
            notification.setRead(false);
            notificationRepository.save(notification);

            // Send email if a template exists for this event type
            String emailTemplate = EVENT_EMAIL_TEMPLATE.get(eventType);
            String email = event.get("email") != null ? event.get("email").toString() : null;
            if (emailTemplate != null && email != null) {
                emailService.sendEmail(email, emailTemplate, Map.of(
                        "invoiceId", invoiceId != null ? invoiceId : "",
                        "subject", title
                ));
            }

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
            case "wallet.low_balance" -> "Your wallet balance is running low. Please top up to avoid service interruption.";
            case "wallet.auto_topped_up" -> "Your wallet has been automatically topped up.";
            default -> "Billing event: " + eventType;
        };
    }
}

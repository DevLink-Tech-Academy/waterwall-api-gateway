package com.gateway.management.service;

import com.gateway.common.events.BaseEvent;
import com.gateway.common.events.EventPublisher;
import com.gateway.common.events.RabbitMQExchanges;
import com.gateway.management.entity.InvoiceEntity;
import com.gateway.management.entity.PaymentMethodEntity;
import com.gateway.management.entity.PlanEntity;
import com.gateway.management.entity.SubscriptionEntity;
import com.gateway.management.entity.enums.SubStatus;
import com.gateway.management.repository.InvoiceRepository;
import com.gateway.management.repository.PaymentMethodRepository;
import com.gateway.management.repository.SubscriptionRepository;
import com.gateway.management.service.payment.PaymentProviderFactory;
import com.gateway.management.service.payment.PaymentProvider;
import com.gateway.management.service.payment.PaymentResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class BillingSchedulerService {

    private final SubscriptionRepository subscriptionRepository;
    private final MonetizationService monetizationService;
    private final PaymentProviderFactory paymentProviderFactory;
    private final PaymentMethodRepository paymentMethodRepository;
    private final InvoiceRepository invoiceRepository;
    private final PaymentGatewaySettingsService paymentGatewaySettingsService;
    private final EventPublisher eventPublisher;

    @Scheduled(cron = "0 0 2 * * *")
    @Transactional
    public void runBillingCycle() {
        log.info("Starting billing cycle");
        List<SubscriptionEntity> activeSubscriptions =
                subscriptionRepository.findByStatus(SubStatus.APPROVED);

        int invoicesGenerated = 0;
        int autoCharged = 0;

        for (SubscriptionEntity sub : activeSubscriptions) {
            try {
                PlanEntity plan = sub.getPlan();
                if (plan == null || "FREE".equalsIgnoreCase(plan.getPricingModel())) {
                    continue;
                }

                String billingPeriod = plan.getBillingPeriod() != null
                        ? plan.getBillingPeriod().toUpperCase() : "MONTHLY";
                String periodStr = calculateBillingPeriod(sub, billingPeriod);

                if (periodStr == null) {
                    continue;
                }

                InvoiceEntity invoice = monetizationService.generateInvoice(
                        sub.getApplicationId(), periodStr);
                invoicesGenerated++;

                publishBillingEvent("invoice.generated", sub.getApplicationId(), invoice.getId());

                if (tryAutoCharge(invoice, sub.getApplicationId())) {
                    autoCharged++;
                }
            } catch (Exception e) {
                log.error("Billing cycle failed for subscription={}: {}",
                        sub.getId(), e.getMessage(), e);
            }
        }

        log.info("Billing cycle complete: {} invoices generated, {} auto-charged",
                invoicesGenerated, autoCharged);
    }

    private String calculateBillingPeriod(SubscriptionEntity sub, String billingPeriod) {
        LocalDate today = LocalDate.now();

        List<InvoiceEntity> existingInvoices = invoiceRepository.findByConsumerId(sub.getApplicationId());
        LocalDate lastBillingEnd = existingInvoices.stream()
                .map(InvoiceEntity::getBillingPeriodEnd)
                .max(LocalDate::compareTo)
                .orElse(null);

        if (lastBillingEnd == null) {
            return YearMonth.from(today).toString();
        }

        long monthsBetween = switch (billingPeriod) {
            case "QUARTERLY" -> 3;
            case "ANNUAL" -> 12;
            default -> 1;
        };

        LocalDate nextDueDate = lastBillingEnd.plusMonths(monthsBetween);
        if (today.isBefore(nextDueDate)) {
            return null;
        }

        LocalDate nextBillingStart = lastBillingEnd.plusDays(1);
        return YearMonth.from(nextBillingStart).toString();
    }

    private boolean tryAutoCharge(InvoiceEntity invoice, UUID consumerId) {
        if (invoice.getTotalAmount().signum() <= 0) {
            invoice.setStatus("PAID");
            invoice.setPaidAt(Instant.now());
            invoiceRepository.save(invoice);
            return true;
        }

        List<PaymentMethodEntity> methods = paymentMethodRepository.findByConsumerId(consumerId);
        PaymentMethodEntity defaultMethod = methods.stream()
                .filter(m -> Boolean.TRUE.equals(m.getIsDefault()))
                .findFirst()
                .orElse(methods.isEmpty() ? null : methods.get(0));

        String authToken = defaultMethod.getAuthorizationToken() != null
                ? defaultMethod.getAuthorizationToken() : defaultMethod.getPaystackAuthorizationCode();
        if (defaultMethod == null || authToken == null) {
            return false;
        }

        try {
            // Use the provider from the payment method, or fall back to active
            PaymentProvider provider = defaultMethod.getProvider() != null
                    ? paymentProviderFactory.getProvider(defaultMethod.getProvider())
                    : paymentProviderFactory.getActiveProvider();
            String reference = "AUTO-" + invoice.getId().toString().substring(0, 8)
                    + "-" + System.currentTimeMillis();

            String custToken = defaultMethod.getCustomerToken() != null
                    ? defaultMethod.getCustomerToken() : defaultMethod.getPaystackCustomerCode();
            PaymentResult.ChargeResult result = provider.chargeAuthorization(
                    authToken,
                    custToken,
                    invoice.getTotalAmount(),
                    invoice.getCurrency() != null ? invoice.getCurrency() : paymentGatewaySettingsService.getDefaultCurrency(),
                    reference);

            if (result.isSuccessful()) {
                invoice.setStatus("PAID");
                invoice.setPaidAt(Instant.now());
                invoice.setPaystackReference(reference);
                invoice.setPaymentMethodId(defaultMethod.getId());
                invoiceRepository.save(invoice);
                publishBillingEvent("invoice.paid", consumerId, invoice.getId());
                return true;
            } else {
                invoice.setStatus("FAILED");
                invoice.setPaystackReference(reference);
                invoice.setDunningStatus("ACTIVE");
                invoice.setDunningStartedAt(Instant.now());
                invoice.setRetryCount(0);
                invoiceRepository.save(invoice);
                publishBillingEvent("payment.failed", consumerId, invoice.getId());
                return false;
            }
        } catch (Exception e) {
            log.error("Auto-charge error for invoice={}: {}", invoice.getId(), e.getMessage());
            return false;
        }
    }

    private void publishBillingEvent(String eventType, UUID consumerId, UUID invoiceId) {
        BillingEvent event = new BillingEvent(eventType, "billing-scheduler",
                consumerId.toString(), invoiceId.toString());
        eventPublisher.publish(RabbitMQExchanges.PLATFORM_EVENTS, eventType, event);
    }

    @lombok.Data
    @lombok.EqualsAndHashCode(callSuper = true)
    @lombok.experimental.SuperBuilder
    @lombok.NoArgsConstructor
    static class BillingEvent extends BaseEvent {
        private String consumerId;
        private String invoiceId;

        BillingEvent(String eventType, String actorId, String consumerId, String invoiceId) {
            super(eventType, actorId, null);
            this.consumerId = consumerId;
            this.invoiceId = invoiceId;
        }
    }
}

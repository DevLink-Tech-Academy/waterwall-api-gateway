package com.gateway.management.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.common.events.EventPublisher;
import com.gateway.common.events.RabbitMQExchanges;
import com.gateway.management.dto.DunningConfig;
import com.gateway.management.entity.InvoiceEntity;
import com.gateway.management.entity.PaymentMethodEntity;
import com.gateway.management.entity.SubscriptionEntity;
import com.gateway.management.entity.enums.SubStatus;
import com.gateway.management.repository.InvoiceRepository;
import com.gateway.management.repository.PaymentMethodRepository;
import com.gateway.management.repository.SubscriptionRepository;
import com.gateway.management.service.payment.PaymentProvider;
import com.gateway.management.service.payment.PaymentProviderFactory;
import com.gateway.management.service.payment.PaymentResult;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class DunningSchedulerService {

    private final InvoiceRepository invoiceRepository;
    private final PaymentMethodRepository paymentMethodRepository;
    private final PaymentProviderFactory paymentProviderFactory;
    private final SubscriptionRepository subscriptionRepository;
    private final EventPublisher eventPublisher;
    private final EntityManager entityManager;
    private final ObjectMapper objectMapper;

    private static final DunningConfig DEFAULT_DUNNING = DunningConfig.builder().build();

    @Scheduled(cron = "0 30 2 * * *")
    @Transactional
    public void runDunningCycle() {
        log.info("Starting dunning cycle");
        processActiveRetries();
        processGracePeriodExpiry();
        log.info("Dunning cycle complete");
    }

    private void processActiveRetries() {
        List<InvoiceEntity> activeInvoices = invoiceRepository.findByDunningStatus("ACTIVE");

        for (InvoiceEntity invoice : activeInvoices) {
            if (invoice.getNextRetryAt() != null && invoice.getNextRetryAt().isAfter(Instant.now())) {
                continue;
            }

            try {
                DunningConfig config = resolveDunningConfig(invoice.getConsumerId());
                int retryCount = invoice.getRetryCount() != null ? invoice.getRetryCount() : 0;

                if (retryCount >= config.getMaxRetries()) {
                    invoice.setDunningStatus("GRACE_PERIOD");
                    Instant graceEnd = Instant.now().plus(config.getGracePeriodDays(), ChronoUnit.DAYS);
                    invoice.setNextRetryAt(graceEnd);
                    invoiceRepository.save(invoice);
                    publishBillingEvent("subscription.grace_period", invoice.getConsumerId(), invoice.getId());
                    log.info("Invoice {} moved to grace period (expires {})", invoice.getId(), graceEnd);
                    continue;
                }

                boolean success = attemptCharge(invoice);
                if (success) {
                    invoice.setStatus("PAID");
                    invoice.setPaidAt(Instant.now());
                    invoice.setDunningStatus(null);
                    invoice.setNextRetryAt(null);
                    invoiceRepository.save(invoice);
                    publishBillingEvent("invoice.paid", invoice.getConsumerId(), invoice.getId());
                    log.info("Dunning retry successful for invoice {}", invoice.getId());
                } else {
                    retryCount++;
                    invoice.setRetryCount(retryCount);
                    List<Integer> intervals = config.getRetryIntervals();
                    int nextIntervalDays = retryCount < intervals.size()
                            ? intervals.get(retryCount)
                            : intervals.get(intervals.size() - 1);
                    invoice.setNextRetryAt(Instant.now().plus(nextIntervalDays, ChronoUnit.DAYS));
                    invoiceRepository.save(invoice);
                    publishBillingEvent("payment.retry_scheduled", invoice.getConsumerId(), invoice.getId());
                    log.warn("Dunning retry {} failed for invoice {}, next retry in {} days",
                            retryCount, invoice.getId(), nextIntervalDays);
                }
            } catch (Exception e) {
                log.error("Dunning failed for invoice {}: {}", invoice.getId(), e.getMessage());
            }
        }
    }

    private void processGracePeriodExpiry() {
        List<InvoiceEntity> graceInvoices = invoiceRepository.findByDunningStatus("GRACE_PERIOD");

        for (InvoiceEntity invoice : graceInvoices) {
            if (invoice.getNextRetryAt() != null && invoice.getNextRetryAt().isAfter(Instant.now())) {
                continue;
            }

            try {
                DunningConfig config = resolveDunningConfig(invoice.getConsumerId());
                invoice.setDunningStatus("EXHAUSTED");
                invoiceRepository.save(invoice);

                String action = config.getFinalAction() != null
                        ? config.getFinalAction().toUpperCase() : "SUSPEND";

                List<SubscriptionEntity> subs = subscriptionRepository
                        .findByApplicationId(invoice.getConsumerId());
                for (SubscriptionEntity sub : subs) {
                    if (sub.getStatus() == SubStatus.APPROVED || sub.getStatus() == SubStatus.ACTIVE) {
                        SubStatus targetStatus = "CANCEL".equals(action)
                                ? SubStatus.CANCELLED : SubStatus.SUSPENDED;
                        sub.setStatus(targetStatus);
                        sub.setReason("Non-payment: dunning exhausted");
                        subscriptionRepository.save(sub);
                        publishBillingEvent("subscription.suspended",
                                invoice.getConsumerId(), invoice.getId());
                        log.info("Subscription {} {} due to non-payment (invoice {})",
                                sub.getId(), targetStatus, invoice.getId());
                    }
                }
            } catch (Exception e) {
                log.error("Grace period processing failed for invoice {}: {}",
                        invoice.getId(), e.getMessage());
            }
        }
    }

    private boolean attemptCharge(InvoiceEntity invoice) {
        List<PaymentMethodEntity> methods = paymentMethodRepository
                .findByConsumerId(invoice.getConsumerId());
        PaymentMethodEntity defaultMethod = methods.stream()
                .filter(m -> Boolean.TRUE.equals(m.getIsDefault()))
                .findFirst()
                .orElse(methods.isEmpty() ? null : methods.get(0));

        if (defaultMethod == null || defaultMethod.getPaystackAuthorizationCode() == null) {
            return false;
        }

        try {
            PaymentProvider provider = paymentProviderFactory.getActiveProvider();
            String reference = "RETRY-" + invoice.getId().toString().substring(0, 8)
                    + "-" + System.currentTimeMillis();

            PaymentResult.ChargeResult result = provider.chargeAuthorization(
                    defaultMethod.getPaystackAuthorizationCode(),
                    defaultMethod.getPaystackCustomerCode(),
                    invoice.getTotalAmount(),
                    invoice.getCurrency() != null ? invoice.getCurrency() : "NGN",
                    reference);

            if (result.isSuccessful()) {
                invoice.setPaystackReference(reference);
                invoice.setPaymentMethodId(defaultMethod.getId());
                return true;
            }
        } catch (Exception e) {
            log.error("Charge attempt failed for invoice {}: {}", invoice.getId(), e.getMessage());
        }
        return false;
    }

    private DunningConfig resolveDunningConfig(UUID consumerId) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT p.dunning_config FROM gateway.plans p " +
                    "JOIN gateway.subscriptions s ON s.plan_id = p.id " +
                    "WHERE s.application_id = :consumerId " +
                    "AND s.status = 'APPROVED' " +
                    "ORDER BY s.created_at DESC LIMIT 1"
            );
            query.setParameter("consumerId", consumerId);
            List<?> results = query.getResultList();
            if (!results.isEmpty() && results.get(0) != null) {
                String json = results.get(0).toString();
                return objectMapper.readValue(json, DunningConfig.class);
            }
        } catch (Exception e) {
            log.debug("Failed to resolve dunning config for consumer={}: {}", consumerId, e.getMessage());
        }
        return DEFAULT_DUNNING;
    }

    private void publishBillingEvent(String eventType, UUID consumerId, UUID invoiceId) {
        BillingSchedulerService.BillingEvent event = BillingSchedulerService.BillingEvent.builder()
                .eventType(eventType)
                .actorId("dunning-scheduler")
                .consumerId(consumerId.toString())
                .invoiceId(invoiceId != null ? invoiceId.toString() : null)
                .build();
        eventPublisher.publish(RabbitMQExchanges.PLATFORM_EVENTS, eventType, event);
    }
}

package com.gateway.management.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.common.auth.SecurityContextHelper;
import com.gateway.management.dto.PaymentInitResponse;
import com.gateway.management.entity.InvoiceEntity;
import com.gateway.management.entity.PaymentMethodEntity;
import com.gateway.management.repository.InvoiceRepository;
import com.gateway.management.repository.PaymentMethodRepository;
import com.gateway.management.service.payment.PaymentProvider;
import com.gateway.management.service.payment.PaymentProviderFactory;
import com.gateway.management.service.payment.PaymentResult;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class PaymentFlowService {

    private final PaymentProviderFactory paymentProviderFactory;
    private final InvoiceRepository invoiceRepository;
    private final PaymentMethodRepository paymentMethodRepository;
    private final ObjectMapper objectMapper;

    private static final Set<String> PAYABLE_STATUSES = Set.of("DRAFT", "SENT", "OVERDUE", "FAILED");

    @Transactional
    public PaymentInitResponse initiateInvoicePayment(UUID invoiceId, String providerName) {
        String userId = SecurityContextHelper.getCurrentUserId();
        String email = SecurityContextHelper.getCurrentEmail();

        InvoiceEntity invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new EntityNotFoundException("Invoice not found: " + invoiceId));

        if (!invoice.getConsumerId().toString().equals(userId)) {
            throw new SecurityException("User does not own this invoice");
        }

        if ("PAID".equals(invoice.getStatus())) {
            throw new IllegalStateException("Invoice is already paid");
        }

        if (!PAYABLE_STATUSES.contains(invoice.getStatus())) {
            throw new IllegalStateException("Invoice status does not allow payment: " + invoice.getStatus());
        }

        // If invoice already has a payment reference, verify it first
        if (invoice.getPaymentReference() != null) {
            try {
                PaymentProvider existingProvider = invoice.getPaymentProvider() != null
                        ? paymentProviderFactory.getProvider(invoice.getPaymentProvider())
                        : paymentProviderFactory.getActiveProvider();
                PaymentResult.VerifyResult existing = existingProvider.verifyPayment(invoice.getPaymentReference());
                if (existing.isSuccessful()) {
                    invoice.setStatus("PAID");
                    invoice.setPaidAt(Instant.now());
                    invoiceRepository.save(invoice);
                    return new PaymentInitResponse(null, invoice.getPaymentReference(), null);
                }
            } catch (Exception e) {
                log.warn("Failed to verify existing reference {}, generating new one",
                        invoice.getPaymentReference(), e);
            }
        }

        // Resolve provider — use specified, or active default
        PaymentProvider provider = providerName != null && !providerName.isBlank()
                ? paymentProviderFactory.getProvider(providerName)
                : paymentProviderFactory.getActiveProvider();

        String reference = "INV-" + invoiceId.toString().substring(0, 8) + "-" + System.currentTimeMillis();

        PaymentResult.InitResult result = provider.initializePayment(
                email, invoice.getTotalAmount(), invoice.getCurrency(), reference, invoiceId);

        invoice.setPaymentReference(reference);
        invoice.setPaymentProvider(provider.getProviderName());
        // Keep legacy field for backwards compatibility
        invoice.setPaystackReference(reference);
        invoice.setStatus("PENDING");
        invoiceRepository.save(invoice);

        return new PaymentInitResponse(result.getAuthorizationUrl(), reference, result.getAccessCode());
    }

    // Backwards-compatible overload
    @Transactional
    public PaymentInitResponse initiateInvoicePayment(UUID invoiceId) {
        return initiateInvoicePayment(invoiceId, null);
    }

    @Transactional
    public InvoiceEntity verifyPayment(String reference, String providerName) {
        // Resolve provider — try from the invoice's stored provider, then param, then default
        InvoiceEntity invoice = findInvoiceByReference(reference);

        PaymentProvider provider;
        if (invoice.getPaymentProvider() != null) {
            provider = paymentProviderFactory.getProvider(invoice.getPaymentProvider());
        } else if (providerName != null) {
            provider = paymentProviderFactory.getProvider(providerName);
        } else {
            provider = paymentProviderFactory.getActiveProvider();
        }

        PaymentResult.VerifyResult result = provider.verifyPayment(reference);

        if (!result.isSuccessful()) {
            throw new IllegalStateException("Payment not successful. Status: " + result.getStatus());
        }

        invoice.setStatus("PAID");
        invoice.setPaidAt(Instant.now());
        invoice.setDunningStatus(null);
        invoice.setNextRetryAt(null);

        if (result.getAuthorizationCode() != null) {
            PaymentMethodEntity paymentMethod = PaymentMethodEntity.builder()
                    .consumerId(invoice.getConsumerId())
                    .type(result.getCardType() != null ? result.getCardType() : "card")
                    .provider(provider.getProviderName())
                    .providerRef(result.getReference())
                    .isDefault(true)
                    .authorizationToken(result.getAuthorizationCode())
                    .customerToken(result.getCustomerCode())
                    // Legacy fields
                    .paystackAuthorizationCode("paystack".equals(provider.getProviderName()) ? result.getAuthorizationCode() : null)
                    .paystackCustomerCode("paystack".equals(provider.getProviderName()) ? result.getCustomerCode() : null)
                    .cardLast4(result.getCardLast4())
                    .cardBrand(result.getCardBrand())
                    .build();
            PaymentMethodEntity saved = paymentMethodRepository.save(paymentMethod);
            invoice.setPaymentMethodId(saved.getId());
        }

        return invoiceRepository.save(invoice);
    }

    // Backwards-compatible overload
    @Transactional
    public InvoiceEntity verifyPayment(String reference) {
        return verifyPayment(reference, null);
    }

    @Transactional
    @SuppressWarnings("unchecked")
    public void handleWebhookEvent(String eventType, Map<String, Object> data) {
        if ("charge.success".equals(eventType)) {
            String reference = (String) data.get("reference");
            log.info("Processing charge.success webhook for reference: {}", reference);

            findInvoiceByReferenceOpt(reference).ifPresent(invoice -> {
                if (!"PAID".equals(invoice.getStatus())) {
                    invoice.setStatus("PAID");
                    invoice.setPaidAt(Instant.now());
                    invoice.setDunningStatus(null);
                    invoice.setNextRetryAt(null);

                    // Extract authorization info from webhook data (Paystack format)
                    Map<String, Object> authData = (Map<String, Object>) data.get("authorization");
                    if (authData != null) {
                        String authCode = (String) authData.get("authorization_code");
                        String last4 = (String) authData.get("last4");
                        String brand = (String) authData.get("brand");
                        String cardType = (String) authData.get("card_type");

                        Map<String, Object> customerData = (Map<String, Object>) data.get("customer");
                        String customerCode = customerData != null
                                ? (String) customerData.get("customer_code") : null;

                        String provider = invoice.getPaymentProvider() != null ? invoice.getPaymentProvider() : "paystack";

                        PaymentMethodEntity paymentMethod = PaymentMethodEntity.builder()
                                .consumerId(invoice.getConsumerId())
                                .type(cardType != null ? cardType : "card")
                                .provider(provider)
                                .providerRef(reference)
                                .isDefault(true)
                                .authorizationToken(authCode)
                                .customerToken(customerCode)
                                .paystackAuthorizationCode("paystack".equals(provider) ? authCode : null)
                                .paystackCustomerCode("paystack".equals(provider) ? customerCode : null)
                                .cardLast4(last4)
                                .cardBrand(brand)
                                .build();
                        PaymentMethodEntity saved = paymentMethodRepository.save(paymentMethod);
                        invoice.setPaymentMethodId(saved.getId());
                    }

                    invoiceRepository.save(invoice);
                    log.info("Invoice {} marked as PAID via webhook", invoice.getId());
                }
            });
        } else if ("charge.failed".equals(eventType)) {
            String reference = (String) data.get("reference");
            log.warn("Processing charge.failed webhook for reference: {}", reference);

            findInvoiceByReferenceOpt(reference).ifPresent(invoice -> {
                if (!"PAID".equals(invoice.getStatus())) {
                    invoice.setStatus("FAILED");
                    if (invoice.getDunningStatus() == null) {
                        invoice.setDunningStatus("ACTIVE");
                        invoice.setDunningStartedAt(Instant.now());
                        invoice.setRetryCount(0);
                    }
                    invoiceRepository.save(invoice);
                    log.info("Invoice {} marked as FAILED via webhook, dunning initiated", invoice.getId());
                }
            });
        } else {
            log.info("Unhandled webhook event type: {}", eventType);
        }
    }

    private InvoiceEntity findInvoiceByReference(String reference) {
        // Try new field first, fall back to legacy
        return invoiceRepository.findByPaymentReference(reference)
                .or(() -> invoiceRepository.findByPaystackReference(reference))
                .orElseThrow(() -> new EntityNotFoundException("Invoice not found for reference: " + reference));
    }

    private Optional<InvoiceEntity> findInvoiceByReferenceOpt(String reference) {
        Optional<InvoiceEntity> result = invoiceRepository.findByPaymentReference(reference);
        if (result.isPresent()) return result;
        return invoiceRepository.findByPaystackReference(reference);
    }
}

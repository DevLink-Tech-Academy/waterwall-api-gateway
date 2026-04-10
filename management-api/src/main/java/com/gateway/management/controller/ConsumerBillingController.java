package com.gateway.management.controller;

import com.gateway.management.dto.AddPaymentMethodRequest;
import com.gateway.management.dto.PaymentInitResponse;
import com.gateway.management.entity.InvoiceEntity;
import com.gateway.management.entity.PaymentMethodEntity;
import com.gateway.management.service.ConsumerBillingService;
import com.gateway.management.service.PaymentFlowService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/v1/consumer")
@RequiredArgsConstructor
@PreAuthorize("isAuthenticated()")
public class ConsumerBillingController {

    private final ConsumerBillingService consumerBillingService;
    private final PaymentFlowService paymentFlowService;
    private final com.gateway.management.service.payment.PaymentProviderFactory paymentProviderFactory;

    // ── Invoices ──────────────────────────────────────────────────────────

    /**
     * Lists all invoices for the authenticated consumer.
     */
    @GetMapping("/invoices")
    public ResponseEntity<List<InvoiceEntity>> listInvoices() {
        return ResponseEntity.ok(consumerBillingService.listInvoices());
    }

    /**
     * Returns a single invoice by ID, verifying it belongs to the current consumer.
     */
    @GetMapping("/invoices/{id}")
    public ResponseEntity<InvoiceEntity> getInvoice(@PathVariable UUID id) {
        return ResponseEntity.ok(consumerBillingService.getInvoice(id));
    }

    // ── Payment Methods ───────────────────────────────────────────────────

    /**
     * Lists all payment methods for the authenticated consumer.
     */
    @GetMapping("/payment-methods")
    public ResponseEntity<List<PaymentMethodEntity>> listPaymentMethods() {
        return ResponseEntity.ok(consumerBillingService.listPaymentMethods());
    }

    /**
     * Adds a new payment method for the authenticated consumer.
     */
    @PostMapping("/payment-methods")
    public ResponseEntity<PaymentMethodEntity> addPaymentMethod(
            @Valid @RequestBody AddPaymentMethodRequest request) {
        PaymentMethodEntity created = consumerBillingService.addPaymentMethod(request);
        return ResponseEntity.status(201).body(created);
    }

    /**
     * Removes a payment method, verifying it belongs to the current consumer.
     */
    @DeleteMapping("/payment-methods/{id}")
    public ResponseEntity<Void> removePaymentMethod(@PathVariable UUID id) {
        consumerBillingService.removePaymentMethod(id);
        return ResponseEntity.noContent().build();
    }

    /**
     * Sets a payment method as the default for the authenticated consumer.
     */
    @PatchMapping("/payment-methods/{id}/default")
    public ResponseEntity<PaymentMethodEntity> setDefaultPaymentMethod(@PathVariable UUID id) {
        return ResponseEntity.ok(consumerBillingService.setDefaultPaymentMethod(id));
    }

    // ── Payments ────────────────────────────────────────────────────────────

    /**
     * Returns the list of payment gateways enabled by the admin.
     */
    @GetMapping("/payment-gateways")
    public ResponseEntity<List<Map<String, String>>> listEnabledGateways() {
        return ResponseEntity.ok(paymentProviderFactory.getEnabledProviders());
    }

    /**
     * Initiates payment for an invoice via the specified (or default) payment gateway.
     */
    @PostMapping("/invoices/{id}/pay")
    public ResponseEntity<PaymentInitResponse> payInvoice(
            @PathVariable UUID id,
            @RequestParam(required = false) String provider) {
        PaymentInitResponse response = paymentFlowService.initiateInvoicePayment(id, provider);
        return ResponseEntity.ok(response);
    }

    /**
     * Verifies a payment after redirect from any payment gateway.
     */
    @GetMapping("/payments/verify")
    public ResponseEntity<InvoiceEntity> verifyPayment(
            @RequestParam String reference,
            @RequestParam(required = false) String provider) {
        InvoiceEntity invoice = paymentFlowService.verifyPayment(reference, provider);
        return ResponseEntity.ok(invoice);
    }
}

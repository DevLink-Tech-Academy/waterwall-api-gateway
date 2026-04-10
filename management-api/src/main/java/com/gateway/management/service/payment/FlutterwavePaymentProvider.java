package com.gateway.management.service.payment;

import com.gateway.management.service.FlutterwaveService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
public class FlutterwavePaymentProvider implements PaymentProvider {

    private final FlutterwaveService flutterwaveService;

    @Override
    public String getProviderName() { return "flutterwave"; }

    @Override
    @SuppressWarnings("unchecked")
    public PaymentResult.InitResult initializePayment(String email, BigDecimal amount,
                                                       String currency, String reference,
                                                       UUID invoiceId) {
        Map<String, Object> response = flutterwaveService.createPaymentLink(
                email, amount, currency, reference, invoiceId,
                "http://localhost:3000/billing");

        Map<String, Object> data = (Map<String, Object>) response.get("data");
        String paymentLink = data != null ? (String) data.get("link") : null;

        return PaymentResult.InitResult.builder()
                .authorizationUrl(paymentLink)
                .reference(reference)
                .build();
    }

    @Override
    @SuppressWarnings("unchecked")
    public PaymentResult.VerifyResult verifyPayment(String reference) {
        Map<String, Object> response = flutterwaveService.verifyTransaction(reference);
        Map<String, Object> data = (Map<String, Object>) response.get("data");

        String status = data != null ? (String) data.get("status") : null;
        boolean success = "successful".equals(status);

        Map<String, Object> card = data != null ? (Map<String, Object>) data.get("card") : null;
        Map<String, Object> customer = data != null ? (Map<String, Object>) data.get("customer") : null;

        return PaymentResult.VerifyResult.builder()
                .successful(success)
                .reference(reference)
                .status(status)
                .authorizationCode(card != null ? (String) card.get("token") : null)
                .customerCode(customer != null && customer.get("id") != null ? customer.get("id").toString() : null)
                .cardLast4(card != null ? (String) card.get("last_4digits") : null)
                .cardBrand(card != null ? (String) card.get("type") : null)
                .cardType(card != null ? (String) card.get("issuer") : null)
                .reusable(card != null && card.get("token") != null)
                .build();
    }

    @Override
    @SuppressWarnings("unchecked")
    public PaymentResult.ChargeResult chargeAuthorization(String authorizationCode,
                                                           String email, BigDecimal amount,
                                                           String currency, String reference) {
        try {
            Map<String, Object> response = flutterwaveService.tokenizedCharge(
                    authorizationCode, email, amount, currency, reference);
            String status = (String) response.get("status");
            boolean success = "success".equals(status);
            return PaymentResult.ChargeResult.builder()
                    .successful(success)
                    .reference(reference)
                    .status(status)
                    .build();
        } catch (Exception e) {
            log.error("Flutterwave charge failed for reference={}: {}", reference, e.getMessage());
            return PaymentResult.ChargeResult.builder()
                    .successful(false).reference(reference).status("failed").message(e.getMessage()).build();
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    public PaymentResult.RefundResult refund(String reference, BigDecimal amount) {
        try {
            Map<String, Object> response = flutterwaveService.createRefund(reference, amount);
            String status = (String) response.get("status");
            boolean success = "success".equals(status);
            return PaymentResult.RefundResult.builder()
                    .successful(success)
                    .refundReference(reference)
                    .message(success ? "Refund processed" : "Refund failed")
                    .build();
        } catch (Exception e) {
            log.error("Flutterwave refund failed: {}", e.getMessage());
            return PaymentResult.RefundResult.builder()
                    .successful(false).refundReference(reference).message(e.getMessage()).build();
        }
    }

    @Override
    public boolean validateWebhook(String payload, String signature) {
        return flutterwaveService.validateWebhookSignature(payload, signature);
    }
}

package com.gateway.management.service.payment;

import com.gateway.management.config.StripeConfig;
import com.gateway.management.repository.PaymentGatewaySettingsRepository;
import com.gateway.management.service.StripeService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
public class StripePaymentProvider implements PaymentProvider {

    private final StripeService stripeService;
    private final StripeConfig stripeConfig;
    private final PaymentGatewaySettingsRepository settingsRepository;

    @Override
    public String getProviderName() { return "stripe"; }

    @Override
    public PaymentResult.InitResult initializePayment(String email, BigDecimal amount,
                                                       String currency, String reference,
                                                       UUID invoiceId) {
        String callbackUrl = stripeConfig.resolveSettings(settingsRepository).getCallbackUrl();
        if (callbackUrl == null || callbackUrl.isBlank()) callbackUrl = "http://localhost:3000/billing";
        Map<String, Object> session = stripeService.createCheckoutSession(
                email, amount, currency, reference, invoiceId, callbackUrl);
        return PaymentResult.InitResult.builder()
                .authorizationUrl((String) session.get("url"))
                .reference(reference)
                .accessCode((String) session.get("id"))
                .build();
    }

    @Override
    public PaymentResult.VerifyResult verifyPayment(String reference) {
        Map<String, Object> session = stripeService.retrieveSession(reference);
        String paymentStatus = (String) session.get("payment_status");
        boolean success = "paid".equals(paymentStatus);

        return PaymentResult.VerifyResult.builder()
                .successful(success)
                .reference(reference)
                .status(paymentStatus)
                .customerCode(session.get("customer") != null ? session.get("customer").toString() : null)
                .build();
    }

    @Override
    public PaymentResult.ChargeResult chargeAuthorization(String authorizationCode,
                                                           String email, BigDecimal amount,
                                                           String currency, String reference) {
        try {
            Map<String, Object> intent = stripeService.createPaymentIntent(
                    amount, currency, email, authorizationCode, reference);
            String status = (String) intent.get("status");
            boolean success = "succeeded".equals(status);
            return PaymentResult.ChargeResult.builder()
                    .successful(success)
                    .reference(reference)
                    .status(status)
                    .build();
        } catch (Exception e) {
            log.error("Stripe charge failed for reference={}: {}", reference, e.getMessage());
            return PaymentResult.ChargeResult.builder()
                    .successful(false).reference(reference).status("failed").message(e.getMessage()).build();
        }
    }

    @Override
    public PaymentResult.RefundResult refund(String reference, BigDecimal amount) {
        try {
            Map<String, Object> refund = stripeService.createRefund(reference, amount);
            boolean success = "succeeded".equals(refund.get("status"));
            return PaymentResult.RefundResult.builder()
                    .successful(success)
                    .refundReference(refund.get("id") != null ? refund.get("id").toString() : reference)
                    .message(success ? "Refund processed" : "Refund pending")
                    .build();
        } catch (Exception e) {
            log.error("Stripe refund failed: {}", e.getMessage());
            return PaymentResult.RefundResult.builder()
                    .successful(false).refundReference(reference).message(e.getMessage()).build();
        }
    }

    @Override
    public boolean validateWebhook(String payload, String signature) {
        return stripeService.validateWebhookSignature(payload, signature);
    }
}

package com.gateway.management.service.payment;

import com.gateway.management.dto.paystack.PaystackInitializeResponse;
import com.gateway.management.dto.paystack.PaystackVerifyResponse;
import com.gateway.management.service.PaystackService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
public class PaystackPaymentProvider implements PaymentProvider {

    private final PaystackService paystackService;

    @Override
    public String getProviderName() { return "paystack"; }

    @Override
    public PaymentResult.InitResult initializePayment(String email, BigDecimal amount, String currency, String reference, UUID invoiceId) {
        PaystackInitializeResponse response = paystackService.initializeTransaction(email, amount, currency, reference, invoiceId);
        return PaymentResult.InitResult.builder()
                .authorizationUrl(response.getData().getAuthorization_url())
                .reference(reference)
                .accessCode(response.getData().getAccess_code())
                .build();
    }

    @Override
    public PaymentResult.VerifyResult verifyPayment(String reference) {
        PaystackVerifyResponse response = paystackService.verifyTransaction(reference);
        PaystackVerifyResponse.PaystackVerifyData data = response.getData();
        PaystackVerifyResponse.PaystackAuthorization auth = data.getAuthorization();
        PaystackVerifyResponse.PaystackCustomer customer = data.getCustomer();

        return PaymentResult.VerifyResult.builder()
                .successful("success".equals(data.getStatus()))
                .reference(data.getReference())
                .status(data.getStatus())
                .authorizationCode(auth != null ? auth.getAuthorization_code() : null)
                .customerCode(customer != null ? customer.getCustomer_code() : null)
                .cardLast4(auth != null ? auth.getLast4() : null)
                .cardBrand(auth != null ? auth.getBrand() : null)
                .cardType(auth != null ? auth.getCard_type() : null)
                .reusable(auth != null && auth.isReusable())
                .build();
    }

    @Override
    public PaymentResult.ChargeResult chargeAuthorization(String authorizationCode, String email, BigDecimal amount, String currency, String reference) {
        try {
            PaystackVerifyResponse response = paystackService.chargeAuthorization(authorizationCode, email, amount, currency, reference);
            return PaymentResult.ChargeResult.builder()
                    .successful("success".equals(response.getData().getStatus()))
                    .reference(reference)
                    .status(response.getData().getStatus())
                    .build();
        } catch (Exception e) {
            log.error("Paystack charge_authorization failed for reference={}: {}", reference, e.getMessage());
            return PaymentResult.ChargeResult.builder().successful(false).reference(reference).status("failed").message(e.getMessage()).build();
        }
    }

    @Override
    public PaymentResult.RefundResult refund(String reference, BigDecimal amount) {
        try {
            Map<String, Object> response = paystackService.refundTransaction(reference, amount);
            boolean success = Boolean.TRUE.equals(response.get("status"));
            return PaymentResult.RefundResult.builder().successful(success).refundReference(reference).message(success ? "Refund processed" : "Refund failed").build();
        } catch (Exception e) {
            log.error("Paystack refund failed for reference={}: {}", reference, e.getMessage());
            return PaymentResult.RefundResult.builder().successful(false).refundReference(reference).message(e.getMessage()).build();
        }
    }

    @Override
    public boolean validateWebhook(String payload, String signature) {
        return paystackService.validateWebhookSignature(payload, signature);
    }
}

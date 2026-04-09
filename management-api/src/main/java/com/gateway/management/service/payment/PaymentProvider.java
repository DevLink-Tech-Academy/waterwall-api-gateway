package com.gateway.management.service.payment;

import java.math.BigDecimal;
import java.util.UUID;

public interface PaymentProvider {
    String getProviderName();
    PaymentResult.InitResult initializePayment(String email, BigDecimal amount, String currency, String reference, UUID invoiceId);
    PaymentResult.VerifyResult verifyPayment(String reference);
    PaymentResult.ChargeResult chargeAuthorization(String authorizationCode, String email, BigDecimal amount, String currency, String reference);
    PaymentResult.RefundResult refund(String reference, BigDecimal amount);
    boolean validateWebhook(String payload, String signature);
}

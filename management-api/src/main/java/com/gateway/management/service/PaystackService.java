package com.gateway.management.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.management.config.PaystackConfig;
import com.gateway.management.dto.paystack.PaystackInitializeResponse;
import com.gateway.management.dto.paystack.PaystackVerifyResponse;
import com.gateway.management.entity.PaymentGatewaySettingsEntity;
import com.gateway.management.repository.PaymentGatewaySettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class PaystackService {

    @Qualifier("paystackRestClient")
    private final RestClient paystackRestClient;
    private final PaystackConfig paystackConfig;
    private final PaymentGatewaySettingsRepository settingsRepository;
    private final ObjectMapper objectMapper;

    private PaymentGatewaySettingsEntity getSettings() {
        return paystackConfig.resolveSettings(settingsRepository);
    }

    public PaystackInitializeResponse initializeTransaction(String email, BigDecimal amount,
                                                            String currency, String reference,
                                                            UUID invoiceId) {
        PaymentGatewaySettingsEntity settings = getSettings();
        long amountInSmallestUnit = amount.multiply(BigDecimal.valueOf(100)).longValueExact();

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("amount", amountInSmallestUnit);
        requestBody.put("email", email);
        requestBody.put("reference", reference);
        requestBody.put("currency", currency);
        requestBody.put("callback_url", settings.getCallbackUrl());
        requestBody.put("metadata", Map.of("invoiceId", invoiceId.toString()));

        String responseBody = paystackRestClient.post()
                .uri(settings.getBaseUrl() + "/transaction/initialize")
                .header("Authorization", "Bearer " + settings.getSecretKey())
                .body(requestBody)
                .retrieve()
                .body(String.class);

        try {
            PaystackInitializeResponse response = objectMapper.readValue(responseBody,
                    PaystackInitializeResponse.class);
            log.info("Paystack transaction initialized - reference: {}, authorization_url: {}",
                    reference, response.getData().getAuthorization_url());
            return response;
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Paystack initialize response", e);
        }
    }

    public PaystackVerifyResponse verifyTransaction(String reference) {
        PaymentGatewaySettingsEntity settings = getSettings();

        String responseBody = paystackRestClient.get()
                .uri(settings.getBaseUrl() + "/transaction/verify/{reference}", reference)
                .header("Authorization", "Bearer " + settings.getSecretKey())
                .retrieve()
                .body(String.class);

        try {
            PaystackVerifyResponse response = objectMapper.readValue(responseBody,
                    PaystackVerifyResponse.class);
            log.info("Paystack transaction verified - reference: {}, status: {}",
                    reference, response.getData().getStatus());
            return response;
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Paystack verify response", e);
        }
    }

    public PaystackVerifyResponse chargeAuthorization(String authorizationCode, String email,
                                                       BigDecimal amount, String currency,
                                                       String reference) {
        PaymentGatewaySettingsEntity settings = getSettings();
        long amountInSmallestUnit = amount.multiply(BigDecimal.valueOf(100)).longValueExact();

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("authorization_code", authorizationCode);
        requestBody.put("email", email);
        requestBody.put("amount", amountInSmallestUnit);
        requestBody.put("currency", currency);
        requestBody.put("reference", reference);

        String responseBody = paystackRestClient.post()
                .uri(settings.getBaseUrl() + "/transaction/charge_authorization")
                .header("Authorization", "Bearer " + settings.getSecretKey())
                .body(requestBody)
                .retrieve()
                .body(String.class);

        try {
            PaystackVerifyResponse response = objectMapper.readValue(responseBody, PaystackVerifyResponse.class);
            log.info("Paystack charge_authorization - reference: {}, status: {}", reference, response.getData().getStatus());
            return response;
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Paystack charge_authorization response", e);
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> refundTransaction(String reference, BigDecimal amount) {
        PaymentGatewaySettingsEntity settings = getSettings();

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("transaction", reference);
        if (amount != null) {
            requestBody.put("amount", amount.multiply(BigDecimal.valueOf(100)).longValueExact());
        }

        String responseBody = paystackRestClient.post()
                .uri(settings.getBaseUrl() + "/refund")
                .header("Authorization", "Bearer " + settings.getSecretKey())
                .body(requestBody)
                .retrieve()
                .body(String.class);

        try {
            Map<String, Object> response = objectMapper.readValue(responseBody, Map.class);
            log.info("Paystack refund - reference: {}, response status: {}", reference, response.get("status"));
            return response;
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Paystack refund response", e);
        }
    }

    public boolean validateWebhookSignature(String payload, String signature) {
        try {
            PaymentGatewaySettingsEntity settings = getSettings();
            Mac mac = Mac.getInstance("HmacSHA512");
            SecretKeySpec secretKeySpec = new SecretKeySpec(
                    settings.getSecretKey().getBytes(StandardCharsets.UTF_8), "HmacSHA512");
            mac.init(secretKeySpec);
            byte[] hmacBytes = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            String computedSignature = HexFormat.of().formatHex(hmacBytes);
            return computedSignature.equalsIgnoreCase(signature);
        } catch (Exception e) {
            log.error("Failed to validate webhook signature", e);
            return false;
        }
    }
}

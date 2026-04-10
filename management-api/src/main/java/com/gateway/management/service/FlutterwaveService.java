package com.gateway.management.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.management.config.FlutterwaveConfig;
import com.gateway.management.entity.PaymentGatewaySettingsEntity;
import com.gateway.management.repository.PaymentGatewaySettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class FlutterwaveService {

    @Qualifier("flutterwaveRestClient")
    private final RestClient flutterwaveRestClient;
    private final FlutterwaveConfig flutterwaveConfig;
    private final PaymentGatewaySettingsRepository settingsRepository;
    private final ObjectMapper objectMapper;

    private PaymentGatewaySettingsEntity getSettings() {
        return flutterwaveConfig.resolveSettings(settingsRepository);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> createPaymentLink(String email, BigDecimal amount,
                                                   String currency, String reference,
                                                   UUID invoiceId, String callbackUrl) {
        PaymentGatewaySettingsEntity settings = getSettings();

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("tx_ref", reference);
        requestBody.put("amount", amount);
        requestBody.put("currency", currency);
        requestBody.put("redirect_url", callbackUrl + "?verify=true&reference=" + reference + "&provider=flutterwave");
        requestBody.put("customer", Map.of("email", email));
        requestBody.put("meta", Map.of("invoiceId", invoiceId != null ? invoiceId.toString() : "", "reference", reference));
        requestBody.put("customizations", Map.of("title", "API Gateway Payment", "description", "Invoice payment"));

        try {
            String responseBody = flutterwaveRestClient.post()
                    .uri(settings.getBaseUrl() + "/payments")
                    .header("Authorization", "Bearer " + settings.getSecretKey())
                    .body(requestBody)
                    .retrieve()
                    .body(String.class);

            Map<String, Object> response = objectMapper.readValue(responseBody, Map.class);
            log.info("Flutterwave payment link created - tx_ref: {}", reference);
            return response;
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            log.error("Flutterwave createPaymentLink failed: {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
            throw new IllegalStateException("Flutterwave error: " + extractMessage(e.getResponseBodyAsString()), e);
        } catch (Exception e) {
            throw new RuntimeException("Failed to create Flutterwave payment link: " + e.getMessage(), e);
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> verifyTransaction(String transactionId) {
        PaymentGatewaySettingsEntity settings = getSettings();
        try {
            String responseBody = flutterwaveRestClient.get()
                    .uri(settings.getBaseUrl() + "/transactions/" + transactionId + "/verify")
                    .header("Authorization", "Bearer " + settings.getSecretKey())
                    .retrieve()
                    .body(String.class);
            return objectMapper.readValue(responseBody, Map.class);
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            log.error("Flutterwave verify failed: {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
            throw new IllegalStateException("Flutterwave verification failed: " + extractMessage(e.getResponseBodyAsString()), e);
        } catch (Exception e) {
            throw new RuntimeException("Failed to verify Flutterwave transaction: " + e.getMessage(), e);
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> tokenizedCharge(String token, String email, BigDecimal amount,
                                                String currency, String reference) {
        PaymentGatewaySettingsEntity settings = getSettings();

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("token", token);
        requestBody.put("email", email);
        requestBody.put("amount", amount);
        requestBody.put("currency", currency);
        requestBody.put("tx_ref", reference);

        try {
            String responseBody = flutterwaveRestClient.post()
                    .uri(settings.getBaseUrl() + "/tokenized-charges")
                    .header("Authorization", "Bearer " + settings.getSecretKey())
                    .body(requestBody)
                    .retrieve()
                    .body(String.class);

            Map<String, Object> response = objectMapper.readValue(responseBody, Map.class);
            log.info("Flutterwave tokenized charge - tx_ref: {}, status: {}", reference, response.get("status"));
            return response;
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            log.error("Flutterwave tokenized charge failed: {}", e.getResponseBodyAsString());
            throw new IllegalStateException("Flutterwave charge failed: " + extractMessage(e.getResponseBodyAsString()), e);
        } catch (Exception e) {
            throw new RuntimeException("Failed to process Flutterwave tokenized charge: " + e.getMessage(), e);
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> createRefund(String transactionId, BigDecimal amount) {
        PaymentGatewaySettingsEntity settings = getSettings();

        Map<String, Object> requestBody = new HashMap<>();
        if (amount != null) {
            requestBody.put("amount", amount);
        }

        try {
            String responseBody = flutterwaveRestClient.post()
                    .uri(settings.getBaseUrl() + "/transactions/" + transactionId + "/refund")
                    .header("Authorization", "Bearer " + settings.getSecretKey())
                    .body(requestBody)
                    .retrieve()
                    .body(String.class);

            Map<String, Object> response = objectMapper.readValue(responseBody, Map.class);
            log.info("Flutterwave refund - transactionId: {}, status: {}", transactionId, response.get("status"));
            return response;
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            log.error("Flutterwave refund failed: {}", e.getResponseBodyAsString());
            throw new IllegalStateException("Flutterwave refund failed: " + extractMessage(e.getResponseBodyAsString()), e);
        } catch (Exception e) {
            throw new RuntimeException("Failed to process Flutterwave refund: " + e.getMessage(), e);
        }
    }

    public boolean validateWebhookSignature(String secretHash, String verifHash) {
        if (secretHash == null || verifHash == null) return false;
        return secretHash.equals(verifHash);
    }

    @SuppressWarnings("unchecked")
    private String extractMessage(String responseBody) {
        try {
            Map<String, Object> body = objectMapper.readValue(responseBody, Map.class);
            String message = body.get("message") != null ? body.get("message").toString() : null;
            return message != null ? message : responseBody;
        } catch (Exception e) {
            return responseBody;
        }
    }
}

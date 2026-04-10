package com.gateway.management.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.management.entity.PaymentGatewaySettingsEntity;
import com.gateway.management.repository.PaymentGatewaySettingsRepository;
import com.gateway.management.service.PaymentFlowService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/v1/webhooks/flutterwave")
@RequiredArgsConstructor
public class FlutterwaveWebhookController {

    private final PaymentFlowService paymentFlowService;
    private final PaymentGatewaySettingsRepository settingsRepository;
    private final ObjectMapper objectMapper;

    @PostMapping
    @SuppressWarnings("unchecked")
    public ResponseEntity<String> handleWebhook(
            @RequestBody String payload,
            @RequestHeader(value = "verif-hash", required = false) String verifHash) {

        // Validate webhook signature
        String secretHash = settingsRepository.findByProvider("flutterwave")
                .map(PaymentGatewaySettingsEntity::getSecretKey)
                .orElse(null);

        if (verifHash == null || !verifHash.equals(secretHash)) {
            log.warn("Invalid Flutterwave webhook signature");
            return ResponseEntity.status(401).body("Invalid signature");
        }

        try {
            Map<String, Object> event = objectMapper.readValue(payload, Map.class);
            String eventType = (String) event.get("event");
            Map<String, Object> data = (Map<String, Object>) event.get("data");

            if (data == null) {
                return ResponseEntity.ok("OK");
            }

            log.info("Flutterwave webhook received: event={}", eventType);

            String normalizedType = switch (eventType != null ? eventType : "") {
                case "charge.completed" -> {
                    String status = (String) data.get("status");
                    yield "successful".equals(status) ? "charge.success" : "charge.failed";
                }
                case "transfer.completed" -> "charge.success";
                default -> eventType;
            };

            String txRef = (String) data.get("tx_ref");
            if (txRef != null) {
                data.put("reference", txRef);
                paymentFlowService.handleWebhookEvent(normalizedType, data);
            }

            return ResponseEntity.ok("OK");
        } catch (Exception e) {
            log.error("Failed to process Flutterwave webhook", e);
            return ResponseEntity.ok("OK");
        }
    }
}

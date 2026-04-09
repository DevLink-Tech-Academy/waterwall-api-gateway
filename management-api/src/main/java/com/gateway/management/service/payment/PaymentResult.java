package com.gateway.management.service.payment;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

public class PaymentResult {

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class InitResult {
        private String authorizationUrl;
        private String reference;
        private String accessCode;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class VerifyResult {
        private boolean successful;
        private String reference;
        private String status;
        private String authorizationCode;
        private String customerCode;
        private String cardLast4;
        private String cardBrand;
        private String cardType;
        private boolean reusable;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ChargeResult {
        private boolean successful;
        private String reference;
        private String status;
        private String message;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RefundResult {
        private boolean successful;
        private String refundReference;
        private String message;
    }
}

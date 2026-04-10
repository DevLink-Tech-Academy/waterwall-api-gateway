package com.gateway.management.config;

import com.gateway.management.entity.PaymentGatewaySettingsEntity;
import com.gateway.management.repository.PaymentGatewaySettingsRepository;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

import java.util.Optional;

@Data
@Slf4j
@Configuration
@ConfigurationProperties(prefix = "flutterwave")
public class FlutterwaveConfig {

    private String secretKey;
    private String publicKey;
    private String encryptionKey;
    private String baseUrl = "https://api.flutterwave.com/v3";

    public PaymentGatewaySettingsEntity resolveSettings(PaymentGatewaySettingsRepository repository) {
        Optional<PaymentGatewaySettingsEntity> dbSettings = repository.findByProvider("flutterwave");
        if (dbSettings.isPresent()) {
            return dbSettings.get();
        }
        return PaymentGatewaySettingsEntity.builder()
                .provider("flutterwave")
                .displayName("Flutterwave")
                .enabled(false)
                .secretKey(secretKey)
                .publicKey(publicKey)
                .baseUrl(baseUrl)
                .build();
    }

    @Bean("flutterwaveRestClient")
    public RestClient flutterwaveRestClient() {
        return RestClient.builder()
                .defaultHeader("Content-Type", "application/json")
                .build();
    }
}

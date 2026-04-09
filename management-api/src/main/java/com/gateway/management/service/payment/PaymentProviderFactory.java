package com.gateway.management.service.payment;

import com.gateway.management.entity.PaymentGatewaySettingsEntity;
import com.gateway.management.repository.PaymentGatewaySettingsRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Component
public class PaymentProviderFactory {

    private final Map<String, PaymentProvider> providers;
    private final PaymentGatewaySettingsRepository settingsRepository;

    public PaymentProviderFactory(List<PaymentProvider> providerList, PaymentGatewaySettingsRepository settingsRepository) {
        this.providers = providerList.stream().collect(Collectors.toMap(PaymentProvider::getProviderName, Function.identity()));
        this.settingsRepository = settingsRepository;
        log.info("Registered payment providers: {}", providers.keySet());
    }

    public PaymentProvider getActiveProvider() {
        List<PaymentGatewaySettingsEntity> allSettings = settingsRepository.findAll();
        for (PaymentGatewaySettingsEntity settings : allSettings) {
            if (Boolean.TRUE.equals(settings.getEnabled())) {
                PaymentProvider provider = providers.get(settings.getProvider());
                if (provider != null) return provider;
                log.warn("Enabled payment gateway '{}' has no registered provider implementation", settings.getProvider());
            }
        }
        PaymentProvider fallback = providers.get("paystack");
        if (fallback != null) {
            log.debug("No enabled payment gateway found, falling back to paystack");
            return fallback;
        }
        throw new IllegalStateException("No payment provider available");
    }

    public PaymentProvider getProvider(String providerName) {
        PaymentProvider provider = providers.get(providerName);
        if (provider == null) throw new IllegalArgumentException("Unknown payment provider: " + providerName);
        return provider;
    }
}

package com.gateway.management.service.payment;

import com.gateway.management.entity.PaymentGatewaySettingsEntity;
import com.gateway.management.repository.PaymentGatewaySettingsRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PaymentProviderFactoryTest {

    @Mock private PaymentGatewaySettingsRepository settingsRepository;

    @Test
    void shouldReturnEnabledProvider() {
        PaymentProvider mockProvider = mock(PaymentProvider.class);
        when(mockProvider.getProviderName()).thenReturn("paystack");
        PaymentGatewaySettingsEntity settings = PaymentGatewaySettingsEntity.builder().provider("paystack").enabled(true).build();
        when(settingsRepository.findAll()).thenReturn(List.of(settings));
        PaymentProviderFactory factory = new PaymentProviderFactory(List.of(mockProvider), settingsRepository);
        assertThat(factory.getActiveProvider()).isEqualTo(mockProvider);
    }

    @Test
    void shouldFallbackToPaystackWhenNoneEnabled() {
        PaymentProvider mockProvider = mock(PaymentProvider.class);
        when(mockProvider.getProviderName()).thenReturn("paystack");
        when(settingsRepository.findAll()).thenReturn(List.of());
        PaymentProviderFactory factory = new PaymentProviderFactory(List.of(mockProvider), settingsRepository);
        assertThat(factory.getActiveProvider()).isEqualTo(mockProvider);
    }

    @Test
    void shouldThrowWhenNoProvidersAvailable() {
        when(settingsRepository.findAll()).thenReturn(List.of());
        PaymentProviderFactory factory = new PaymentProviderFactory(List.of(), settingsRepository);
        assertThatThrownBy(factory::getActiveProvider).isInstanceOf(IllegalStateException.class);
    }
}

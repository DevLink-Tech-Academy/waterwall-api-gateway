package com.gateway.management.service;

import com.gateway.common.events.EventPublisher;
import com.gateway.common.events.RabbitMQExchanges;
import com.gateway.management.entity.PaymentMethodEntity;
import com.gateway.management.entity.WalletEntity;
import com.gateway.management.repository.PaymentMethodRepository;
import com.gateway.management.repository.WalletRepository;
import com.gateway.management.service.payment.PaymentProvider;
import com.gateway.management.service.payment.PaymentProviderFactory;
import com.gateway.management.service.payment.PaymentResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class WalletAutoTopUpScheduler {

    private final WalletRepository walletRepository;
    private final WalletService walletService;
    private final PaymentMethodRepository paymentMethodRepository;
    private final PaymentProviderFactory paymentProviderFactory;
    private final PlatformSettingsService platformSettingsService;
    private final EventPublisher eventPublisher;

    /**
     * Runs every 30 minutes. Only active in PAY_AS_YOU_GO mode.
     * Finds wallets where auto-top-up is enabled and balance is below threshold.
     */
    @Scheduled(cron = "0 0/30 * * * *")
    @Transactional
    public void processAutoTopUps() {
        if (!platformSettingsService.isPayAsYouGoMode()) {
            return;
        }

        List<WalletEntity> wallets = walletRepository.findWalletsNeedingTopUp();

        if (wallets.isEmpty()) {
            log.debug("No wallets need auto-top-up");
            return;
        }

        log.info("Processing auto-top-up for {} wallets", wallets.size());

        for (WalletEntity wallet : wallets) {
            try {
                if (wallet.getAutoTopUpAmount() == null || wallet.getAutoTopUpAmount().signum() <= 0) {
                    log.warn("Wallet {} has auto-top-up enabled but no amount configured", wallet.getId());
                    continue;
                }

                // Find default payment method for this consumer
                List<PaymentMethodEntity> methods = paymentMethodRepository
                        .findByConsumerId(wallet.getConsumerId());
                PaymentMethodEntity defaultMethod = methods.stream()
                        .filter(m -> Boolean.TRUE.equals(m.getIsDefault()))
                        .findFirst()
                        .orElse(methods.isEmpty() ? null : methods.get(0));

                if (defaultMethod == null) {
                    log.debug("No payment method for wallet {}, skipping auto-top-up", wallet.getId());
                    continue;
                }

                String authToken = defaultMethod.getAuthorizationToken() != null
                        ? defaultMethod.getAuthorizationToken() : defaultMethod.getPaystackAuthorizationCode();
                if (authToken == null) {
                    log.debug("No authorization token for wallet {}, skipping", wallet.getId());
                    continue;
                }

                // Resolve provider from payment method
                PaymentProvider provider = defaultMethod.getProvider() != null
                        ? paymentProviderFactory.getProvider(defaultMethod.getProvider())
                        : paymentProviderFactory.getActiveProvider();

                String reference = "AUTOTOPUP-" + wallet.getId().toString().substring(0, 8)
                        + "-" + System.currentTimeMillis();

                String custToken = defaultMethod.getCustomerToken() != null
                        ? defaultMethod.getCustomerToken() : defaultMethod.getPaystackCustomerCode();

                PaymentResult.ChargeResult result = provider.chargeAuthorization(
                        authToken, custToken, wallet.getAutoTopUpAmount(),
                        wallet.getCurrency(), reference);

                if (result.isSuccessful()) {
                    walletService.topUp(wallet.getConsumerId(), wallet.getAutoTopUpAmount(),
                            reference, "Auto top-up via " + provider.getProviderName());
                    log.info("Auto-top-up successful: wallet={} amount={} reference={}",
                            wallet.getId(), wallet.getAutoTopUpAmount(), reference);

                    BillingSchedulerService.BillingEvent event = BillingSchedulerService.BillingEvent.builder()
                            .eventType("wallet.auto_topped_up")
                            .actorId("auto-topup-scheduler")
                            .consumerId(wallet.getConsumerId().toString())
                            .build();
                    eventPublisher.publish(RabbitMQExchanges.PLATFORM_EVENTS, "wallet.auto_topped_up", event);
                } else {
                    log.warn("Auto-top-up charge failed: wallet={} status={}", wallet.getId(), result.getStatus());
                }
            } catch (Exception e) {
                log.error("Auto-top-up failed for wallet {}: {}", wallet.getId(), e.getMessage());
            }
        }
    }
}

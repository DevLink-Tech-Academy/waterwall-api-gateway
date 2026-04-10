package com.gateway.management.service;

import com.gateway.common.auth.SecurityContextHelper;
import com.gateway.common.events.EventPublisher;
import com.gateway.common.events.RabbitMQExchanges;
import com.gateway.management.entity.PaymentMethodEntity;
import com.gateway.management.entity.WalletEntity;
import com.gateway.management.repository.PaymentMethodRepository;
import com.gateway.management.service.payment.PaymentResult;
import com.gateway.management.entity.WalletTransactionEntity;
import com.gateway.management.repository.InvoiceRepository;
import com.gateway.management.repository.WalletRepository;
import com.gateway.management.repository.WalletTransactionRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class WalletService {

    private final WalletRepository walletRepository;
    private final WalletTransactionRepository walletTransactionRepository;
    private final PaymentMethodRepository paymentMethodRepository;
    private final PaymentGatewaySettingsService paymentGatewaySettingsService;
    private final EventPublisher eventPublisher;

    @Transactional
    public WalletEntity getOrCreateWallet(UUID consumerId) {
        return walletRepository.findByConsumerId(consumerId)
                .orElseGet(() -> {
                    try {
                        WalletEntity wallet = WalletEntity.builder()
                                .consumerId(consumerId)
                                .balance(BigDecimal.ZERO)
                                .currency(paymentGatewaySettingsService.getDefaultCurrency())
                                .build();
                        log.info("Created wallet for consumer={}", consumerId);
                        return walletRepository.save(wallet);
                    } catch (org.springframework.dao.DataIntegrityViolationException e) {
                        // Race condition — another thread created it first
                        return walletRepository.findByConsumerId(consumerId).orElseThrow();
                    }
                });
    }

    @Transactional(readOnly = true)
    public WalletEntity getWallet() {
        UUID consumerId = resolveConsumerId();
        return getOrCreateWallet(consumerId);
    }

    @Transactional
    public WalletEntity topUp(UUID consumerId, BigDecimal amount, String reference, String description) {
        WalletEntity wallet = getOrCreateWallet(consumerId);
        wallet.setBalance(wallet.getBalance().add(amount));
        wallet = walletRepository.save(wallet);

        WalletTransactionEntity txn = WalletTransactionEntity.builder()
                .walletId(wallet.getId())
                .type("CREDIT")
                .amount(amount)
                .currency(wallet.getCurrency())
                .reference(reference)
                .description(description != null ? description : "Wallet top-up")
                .balanceAfter(wallet.getBalance())
                .build();
        walletTransactionRepository.save(txn);

        log.info("Wallet topped up: consumer={} amount={} newBalance={}", consumerId, amount, wallet.getBalance());
        return wallet;
    }

    @Transactional
    public WalletEntity deduct(UUID consumerId, BigDecimal amount, String reference,
                                String description, UUID invoiceId) {
        WalletEntity wallet = getOrCreateWallet(consumerId);

        if (wallet.getBalance().compareTo(amount) < 0) {
            throw new IllegalStateException("Insufficient wallet balance. Available: "
                    + wallet.getBalance() + ", Required: " + amount);
        }

        wallet.setBalance(wallet.getBalance().subtract(amount));
        wallet = walletRepository.save(wallet);

        WalletTransactionEntity txn = WalletTransactionEntity.builder()
                .walletId(wallet.getId())
                .type("DEBIT")
                .amount(amount)
                .currency(wallet.getCurrency())
                .reference(reference)
                .description(description != null ? description : "Payment deduction")
                .balanceAfter(wallet.getBalance())
                .relatedInvoiceId(invoiceId)
                .build();
        walletTransactionRepository.save(txn);

        log.info("Wallet debited: consumer={} amount={} newBalance={}", consumerId, amount, wallet.getBalance());

        // Check low balance threshold and notify
        if (wallet.getLowBalanceThreshold() != null
                && wallet.getBalance().compareTo(wallet.getLowBalanceThreshold()) < 0) {
            publishLowBalanceAlert(consumerId, wallet.getBalance(), wallet.getLowBalanceThreshold());
        }

        return wallet;
    }

    @Transactional(readOnly = true)
    public Page<WalletTransactionEntity> getTransactions(Pageable pageable) {
        UUID consumerId = resolveConsumerId();
        WalletEntity wallet = getOrCreateWallet(consumerId);
        return walletTransactionRepository.findByWalletIdOrderByCreatedAtDesc(wallet.getId(), pageable);
    }

    @Transactional
    public WalletEntity updateSettings(UUID consumerId, Boolean autoTopUpEnabled,
                                        BigDecimal autoTopUpThreshold, BigDecimal autoTopUpAmount,
                                        BigDecimal lowBalanceThreshold) {
        WalletEntity wallet = getOrCreateWallet(consumerId);

        if (autoTopUpEnabled != null) wallet.setAutoTopUpEnabled(autoTopUpEnabled);
        if (autoTopUpThreshold != null) wallet.setAutoTopUpThreshold(autoTopUpThreshold);
        if (autoTopUpAmount != null) wallet.setAutoTopUpAmount(autoTopUpAmount);
        if (lowBalanceThreshold != null) wallet.setLowBalanceThreshold(lowBalanceThreshold);

        wallet = walletRepository.save(wallet);
        log.info("Wallet settings updated: consumer={} autoTopUp={} threshold={} amount={} lowBalance={}",
                consumerId, wallet.getAutoTopUpEnabled(), wallet.getAutoTopUpThreshold(),
                wallet.getAutoTopUpAmount(), wallet.getLowBalanceThreshold());
        return wallet;
    }

    /**
     * Checks if consumer has sufficient wallet balance for the given amount.
     */
    @Transactional(readOnly = true)
    public boolean hasSufficientBalance(UUID consumerId, BigDecimal amount) {
        return walletRepository.findByConsumerId(consumerId)
                .map(w -> w.getBalance().compareTo(amount) >= 0)
                .orElse(false);
    }

    /**
     * Gets wallet balance for a consumer, returns ZERO if no wallet exists.
     */
    @Transactional(readOnly = true)
    public BigDecimal getBalance(UUID consumerId) {
        return walletRepository.findByConsumerId(consumerId)
                .map(WalletEntity::getBalance)
                .orElse(BigDecimal.ZERO);
    }

    @Transactional
    public void setPendingTopup(UUID consumerId, BigDecimal amount, String reference) {
        WalletEntity wallet = getOrCreateWallet(consumerId);
        wallet.setPendingTopupAmount(amount);
        wallet.setPendingTopupReference(reference);
        walletRepository.save(wallet);
        log.debug("Pending top-up set: consumer={} amount={} reference={}", consumerId, amount, reference);
    }

    @Transactional
    public WalletEntity completePendingTopup(UUID consumerId, String reference, String providerName) {
        WalletEntity wallet = getOrCreateWallet(consumerId);

        BigDecimal amount = wallet.getPendingTopupAmount();
        if (amount == null || amount.signum() <= 0) {
            // Check if this top-up was already completed (idempotency)
            boolean alreadyProcessed = walletTransactionRepository
                    .findByWalletIdOrderByCreatedAtDesc(wallet.getId(), org.springframework.data.domain.PageRequest.of(0, 10))
                    .getContent().stream()
                    .anyMatch(t -> reference.equals(t.getReference()));
            if (alreadyProcessed) {
                log.info("Top-up already processed for reference={}, returning current wallet", reference);
                return wallet;
            }
            throw new IllegalStateException("No pending top-up found for reference: " + reference);
        }

        // Verify reference matches
        if (wallet.getPendingTopupReference() != null && !wallet.getPendingTopupReference().equals(reference)) {
            log.warn("Top-up reference mismatch: expected={} got={}", wallet.getPendingTopupReference(), reference);
        }

        // Credit wallet
        wallet = topUp(consumerId, amount, reference, "Wallet top-up via " + providerName);

        // Clear pending
        wallet.setPendingTopupAmount(null);
        wallet.setPendingTopupReference(null);
        walletRepository.save(wallet);

        return wallet;
    }

    @Transactional
    public void savePaymentMethodFromTopup(UUID consumerId, PaymentResult.VerifyResult result, String providerName) {
        if (result.getAuthorizationCode() == null) return;

        PaymentMethodEntity pm = PaymentMethodEntity.builder()
                .consumerId(consumerId)
                .type(result.getCardType() != null ? result.getCardType() : "card")
                .provider(providerName)
                .providerRef(result.getReference())
                .isDefault(true)
                .authorizationToken(result.getAuthorizationCode())
                .customerToken(result.getCustomerCode())
                .cardLast4(result.getCardLast4())
                .cardBrand(result.getCardBrand())
                .build();
        paymentMethodRepository.save(pm);
        log.info("Payment method saved from top-up: consumer={} provider={}", consumerId, providerName);
    }

    private void publishLowBalanceAlert(UUID consumerId, BigDecimal balance, BigDecimal threshold) {
        log.warn("Low wallet balance: consumer={} balance={} threshold={}", consumerId, balance, threshold);
        BillingSchedulerService.BillingEvent event = BillingSchedulerService.BillingEvent.builder()
                .eventType("wallet.low_balance")
                .actorId("wallet-service")
                .consumerId(consumerId.toString())
                .build();
        eventPublisher.publish(RabbitMQExchanges.PLATFORM_EVENTS, "wallet.low_balance", event);
    }

    private UUID resolveConsumerId() {
        String userId = SecurityContextHelper.getCurrentUserId();
        if (userId == null) {
            throw new IllegalStateException("No authenticated consumer found");
        }
        return UUID.fromString(userId);
    }
}

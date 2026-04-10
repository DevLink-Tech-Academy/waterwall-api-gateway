package com.gateway.management.service;

import com.gateway.management.entity.PlatformSettingEntity;
import com.gateway.management.repository.PlatformSettingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class PlatformSettingsService {

    private final PlatformSettingRepository repository;

    public static final String BILLING_MODE = "billing_mode";
    public static final String WALLET_DEDUCTION_INTERVAL = "wallet_deduction_interval_minutes";

    public static final String MODE_SUBSCRIPTION = "SUBSCRIPTION";
    public static final String MODE_PAY_AS_YOU_GO = "PAY_AS_YOU_GO";

    @Transactional(readOnly = true)
    public String getBillingMode() {
        return getValue(BILLING_MODE, MODE_SUBSCRIPTION);
    }

    @Transactional(readOnly = true)
    public boolean isSubscriptionMode() {
        return MODE_SUBSCRIPTION.equals(getBillingMode());
    }

    @Transactional(readOnly = true)
    public boolean isPayAsYouGoMode() {
        return MODE_PAY_AS_YOU_GO.equals(getBillingMode());
    }

    @Transactional(readOnly = true)
    public int getWalletDeductionIntervalMinutes() {
        String val = getValue(WALLET_DEDUCTION_INTERVAL, "5");
        try {
            return Integer.parseInt(val);
        } catch (NumberFormatException e) {
            return 5;
        }
    }

    @Transactional(readOnly = true)
    public String getValue(String key, String defaultValue) {
        return repository.findBySettingKey(key)
                .map(PlatformSettingEntity::getSettingValue)
                .orElse(defaultValue);
    }

    @Transactional
    public PlatformSettingEntity setValue(String key, String value) {
        PlatformSettingEntity entity = repository.findBySettingKey(key)
                .orElse(PlatformSettingEntity.builder().settingKey(key).build());
        entity.setSettingValue(value);
        entity = repository.save(entity);
        log.info("Platform setting updated: {}={}", key, value);
        return entity;
    }

    @Transactional(readOnly = true)
    public List<PlatformSettingEntity> getAll() {
        return repository.findAll();
    }

    @Transactional(readOnly = true)
    public Map<String, String> getAllAsMap() {
        return repository.findAll().stream()
                .collect(Collectors.toMap(
                        PlatformSettingEntity::getSettingKey,
                        PlatformSettingEntity::getSettingValue));
    }
}

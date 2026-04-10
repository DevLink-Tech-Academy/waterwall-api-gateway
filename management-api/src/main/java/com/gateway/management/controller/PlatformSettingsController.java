package com.gateway.management.controller;

import com.gateway.management.entity.PlatformSettingEntity;
import com.gateway.management.service.PlatformSettingsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/v1/platform-settings")
@RequiredArgsConstructor
public class PlatformSettingsController {

    private final PlatformSettingsService platformSettingsService;

    @GetMapping
    public ResponseEntity<List<PlatformSettingEntity>> getAll() {
        return ResponseEntity.ok(platformSettingsService.getAll());
    }

    @GetMapping("/billing-mode")
    public ResponseEntity<Map<String, String>> getBillingMode() {
        return ResponseEntity.ok(Map.of("billingMode", platformSettingsService.getBillingMode()));
    }

    @PutMapping("/billing-mode")
    public ResponseEntity<PlatformSettingEntity> setBillingMode(@RequestBody Map<String, String> request) {
        String mode = request.get("billingMode");
        if (!PlatformSettingsService.MODE_SUBSCRIPTION.equals(mode)
                && !PlatformSettingsService.MODE_PAY_AS_YOU_GO.equals(mode)) {
            throw new IllegalArgumentException("Invalid billing mode. Must be SUBSCRIPTION or PAY_AS_YOU_GO");
        }
        return ResponseEntity.ok(platformSettingsService.setValue(PlatformSettingsService.BILLING_MODE, mode));
    }

    @PutMapping("/{key}")
    public ResponseEntity<PlatformSettingEntity> updateSetting(
            @PathVariable String key,
            @RequestBody Map<String, String> request) {
        String value = request.get("value");
        return ResponseEntity.ok(platformSettingsService.setValue(key, value));
    }
}

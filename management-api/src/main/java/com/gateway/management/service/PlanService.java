package com.gateway.management.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.management.dto.CreatePlanRequest;
import com.gateway.management.dto.DunningConfig;
import com.gateway.management.dto.PlanResponse;
import com.gateway.management.dto.QuotaConfig;
import com.gateway.management.dto.RateLimitsConfig;
import com.gateway.management.entity.PlanEntity;
import com.gateway.management.repository.PlanRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class PlanService {

    private final PlanRepository planRepository;
    private final ObjectMapper objectMapper;

    @Transactional
    public PlanResponse createPlan(CreatePlanRequest request) {
        PlanEntity entity = PlanEntity.builder()
                .name(request.getName())
                .description(request.getDescription())
                .rateLimits(serializeJson(request.getRateLimits()))
                .quota(serializeJson(request.getQuota()))
                .enforcement(request.getEnforcement())
                .status("ACTIVE")
                // Pricing fields
                .pricingModel(request.getPricingModel() != null ? request.getPricingModel() : "FREE")
                .priceAmount(request.getPriceAmount())
                .currency(request.getCurrency() != null ? request.getCurrency() : "NGN")
                .billingPeriod(request.getBillingPeriod())
                .includedRequests(request.getIncludedRequests())
                .overageRate(request.getOverageRate())
                .dunningConfig(serializeJson(request.getDunningConfig()))
                .build();

        PlanEntity saved = planRepository.save(entity);
        log.info("Plan created: id={}, name={}", saved.getId(), saved.getName());
        return toResponse(saved);
    }

    @Transactional(readOnly = true)
    public List<PlanResponse> listPlans() {
        return planRepository.findAll().stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public PlanResponse getPlan(UUID id) {
        PlanEntity entity = findPlanOrThrow(id);
        return toResponse(entity);
    }

    @Transactional
    public PlanResponse updatePlan(UUID id, CreatePlanRequest request) {
        PlanEntity entity = findPlanOrThrow(id);

        if (request.getName() != null) {
            entity.setName(request.getName());
        }
        if (request.getDescription() != null) {
            entity.setDescription(request.getDescription());
        }
        if (request.getRateLimits() != null) {
            entity.setRateLimits(serializeJson(request.getRateLimits()));
        }
        if (request.getQuota() != null) {
            entity.setQuota(serializeJson(request.getQuota()));
        }
        if (request.getEnforcement() != null) {
            entity.setEnforcement(request.getEnforcement());
        }
        // Pricing fields
        if (request.getPricingModel() != null) {
            entity.setPricingModel(request.getPricingModel());
        }
        if (request.getPriceAmount() != null) {
            entity.setPriceAmount(request.getPriceAmount());
        }
        if (request.getCurrency() != null) {
            entity.setCurrency(request.getCurrency());
        }
        if (request.getBillingPeriod() != null) {
            entity.setBillingPeriod(request.getBillingPeriod());
        }
        if (request.getIncludedRequests() != null) {
            entity.setIncludedRequests(request.getIncludedRequests());
        }
        if (request.getOverageRate() != null) {
            entity.setOverageRate(request.getOverageRate());
        }
        if (request.getDunningConfig() != null) {
            entity.setDunningConfig(serializeJson(request.getDunningConfig()));
        }

        PlanEntity saved = planRepository.save(entity);
        log.info("Plan updated: id={}", saved.getId());
        return toResponse(saved);
    }

    @Transactional
    public void deletePlan(UUID id) {
        PlanEntity entity = findPlanOrThrow(id);
        planRepository.delete(entity);
        log.info("Plan deleted: id={}", id);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private PlanEntity findPlanOrThrow(UUID id) {
        return planRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Plan not found: " + id));
    }

    private String serializeJson(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Failed to serialize value to JSON", e);
        }
    }

    private <T> T deserializeJson(String json, Class<T> clazz) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, clazz);
        } catch (JsonProcessingException e) {
            log.warn("Failed to deserialize JSON: {}", e.getMessage());
            return null;
        }
    }

    private PlanResponse toResponse(PlanEntity entity) {
        RateLimitsConfig rateLimits = deserializeJson(entity.getRateLimits(), RateLimitsConfig.class);
        QuotaConfig quota = deserializeJson(entity.getQuota(), QuotaConfig.class);

        return PlanResponse.builder()
                .id(entity.getId())
                .name(entity.getName())
                .description(entity.getDescription())
                .requestsPerSecond(rateLimits != null ? rateLimits.getRequestsPerSecond() : null)
                .requestsPerMinute(rateLimits != null ? rateLimits.getRequestsPerMinute() : null)
                .requestsPerDay(rateLimits != null ? rateLimits.getRequestsPerDay() : null)
                .burstAllowance(rateLimits != null ? rateLimits.getBurstAllowance() : null)
                .maxRequestsPerMonth(quota != null ? quota.getMaxRequestsPerMonth() : null)
                .enforcement(entity.getEnforcement())
                .status(entity.getStatus())
                // Pricing fields
                .pricingModel(entity.getPricingModel())
                .priceAmount(entity.getPriceAmount())
                .currency(entity.getCurrency())
                .billingPeriod(entity.getBillingPeriod())
                .includedRequests(entity.getIncludedRequests())
                .overageRate(entity.getOverageRate())
                .dunningConfig(deserializeJson(entity.getDunningConfig(), DunningConfig.class))
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .build();
    }
}

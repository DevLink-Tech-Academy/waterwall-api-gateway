package com.gateway.management.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.management.dto.AttachPolicyRequest;
import com.gateway.management.dto.CreatePolicyRequest;
import com.gateway.management.dto.PolicyAttachmentResponse;
import com.gateway.management.dto.PolicyResponse;
import com.gateway.management.entity.ApiEntity;
import com.gateway.management.entity.PolicyAttachmentEntity;
import com.gateway.management.entity.PolicyEntity;
import com.gateway.management.entity.RouteEntity;
import com.gateway.management.repository.ApiRepository;
import com.gateway.management.repository.PolicyAttachmentRepository;
import com.gateway.management.repository.PolicyRepository;
import com.gateway.management.repository.RouteRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class PolicyService {

    private final PolicyRepository policyRepository;
    private final PolicyAttachmentRepository policyAttachmentRepository;
    private final ApiRepository apiRepository;
    private final RouteRepository routeRepository;
    private final ObjectMapper objectMapper;

    @Transactional
    public PolicyResponse createPolicy(CreatePolicyRequest request) {
        PolicyEntity entity = PolicyEntity.builder()
                .name(request.getName())
                .type(request.getType())
                .config(serializeJson(request.getConfig()))
                .description(request.getDescription())
                .build();

        PolicyEntity saved = policyRepository.save(entity);
        log.info("Policy created: id={}, name={}, type={}", saved.getId(), saved.getName(), saved.getType());
        return toResponse(saved);
    }

    @Transactional(readOnly = true)
    public List<PolicyResponse> listPolicies() {
        return policyRepository.findAll().stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public PolicyResponse getPolicy(UUID id) {
        PolicyEntity entity = findPolicyOrThrow(id);
        return toResponse(entity);
    }

    @Transactional
    public PolicyResponse updatePolicy(UUID id, CreatePolicyRequest request) {
        PolicyEntity entity = findPolicyOrThrow(id);

        if (request.getName() != null) {
            entity.setName(request.getName());
        }
        if (request.getType() != null) {
            entity.setType(request.getType());
        }
        if (request.getConfig() != null) {
            entity.setConfig(serializeJson(request.getConfig()));
        }
        if (request.getDescription() != null) {
            entity.setDescription(request.getDescription());
        }

        entity.setVersion(entity.getVersion() != null ? entity.getVersion() + 1 : 1);

        PolicyEntity saved = policyRepository.save(entity);
        log.info("Policy updated: id={} version={}", saved.getId(), saved.getVersion());
        return toResponse(saved);
    }

    @Transactional
    public void deletePolicy(UUID id) {
        PolicyEntity entity = findPolicyOrThrow(id);
        // Delete all attachments first
        List<PolicyAttachmentEntity> attachments = policyAttachmentRepository.findByPolicy_Id(id);
        if (!attachments.isEmpty()) {
            policyAttachmentRepository.deleteAll(attachments);
            log.info("Deleted {} policy attachments for policy id={}", attachments.size(), id);
        }
        policyRepository.delete(entity);
        log.info("Policy deleted: id={}", id);
    }

    @Transactional
    public void attachPolicy(AttachPolicyRequest request) {
        PolicyEntity policy = findPolicyOrThrow(request.getPolicyId());

        PolicyAttachmentEntity.PolicyAttachmentEntityBuilder builder = PolicyAttachmentEntity.builder()
                .policy(policy)
                .scope(request.getScope() != null ? request.getScope() : "API")
                .priority(request.getPriority());

        if (request.getApiId() != null) {
            ApiEntity api = apiRepository.findById(request.getApiId())
                    .orElseThrow(() -> new EntityNotFoundException("API not found: " + request.getApiId()));
            builder.api(api);
        }

        if (request.getRouteId() != null) {
            RouteEntity route = routeRepository.findById(request.getRouteId())
                    .orElseThrow(() -> new EntityNotFoundException("Route not found: " + request.getRouteId()));
            builder.route(route);
        }

        PolicyAttachmentEntity saved = policyAttachmentRepository.save(builder.build());
        log.info("Policy attached: policyId={}, apiId={}, routeId={}, scope={}",
                request.getPolicyId(), request.getApiId(), request.getRouteId(), request.getScope());
    }

    @Transactional
    public void detachPolicy(UUID attachmentId) {
        PolicyAttachmentEntity attachment = policyAttachmentRepository.findById(attachmentId)
                .orElseThrow(() -> new EntityNotFoundException("Policy attachment not found: " + attachmentId));
        policyAttachmentRepository.delete(attachment);
        log.info("Policy detached: attachmentId={}", attachmentId);
    }

    @Transactional(readOnly = true)
    public List<PolicyResponse> getPoliciesForApi(UUID apiId) {
        List<PolicyAttachmentEntity> attachments = policyAttachmentRepository.findByApi_Id(apiId);
        return attachments.stream()
                .map(att -> toResponse(att.getPolicy()))
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<PolicyAttachmentResponse> listAllAttachments() {
        return policyAttachmentRepository.findAll().stream()
                .map(this::toAttachmentResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<PolicyAttachmentResponse> getAttachmentsForApi(UUID apiId) {
        return policyAttachmentRepository.findByApi_Id(apiId).stream()
                .map(this::toAttachmentResponse)
                .toList();
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private PolicyEntity findPolicyOrThrow(UUID id) {
        return policyRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Policy not found: " + id));
    }

    private String serializeJson(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Failed to serialize config to JSON", e);
        }
    }

    private PolicyResponse toResponse(PolicyEntity entity) {
        return PolicyResponse.builder()
                .id(entity.getId())
                .name(entity.getName())
                .type(entity.getType())
                .config(entity.getConfig())
                .description(entity.getDescription())
                .version(entity.getVersion())
                .createdAt(entity.getCreatedAt())
                .build();
    }

    private PolicyAttachmentResponse toAttachmentResponse(PolicyAttachmentEntity att) {
        PolicyAttachmentResponse.PolicyAttachmentResponseBuilder builder = PolicyAttachmentResponse.builder()
                .id(att.getId())
                .policyId(att.getPolicy().getId())
                .policyName(att.getPolicy().getName())
                .policyType(att.getPolicy().getType())
                .scope(att.getScope())
                .priority(att.getPriority());

        if (att.getApi() != null) {
            builder.apiId(att.getApi().getId())
                   .apiName(att.getApi().getName());
        }
        if (att.getRoute() != null) {
            builder.routeId(att.getRoute().getId())
                   .routePath(att.getRoute().getPath());
        }
        return builder.build();
    }
}

package com.gateway.management.controller;

import com.gateway.common.auth.RequiresPermission;
import com.gateway.management.dto.AttachPolicyRequest;
import com.gateway.management.dto.CreatePolicyRequest;
import com.gateway.management.dto.PolicyAttachmentResponse;
import com.gateway.management.dto.PolicyResponse;
import com.gateway.management.service.PolicyService;
import com.gateway.management.service.TransformTemplateProvider;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/policies")
@RequiredArgsConstructor
public class PolicyController {

    private final PolicyService policyService;
    private final TransformTemplateProvider transformTemplateProvider;

    @PostMapping
    @RequiresPermission("policy:create")
    public ResponseEntity<PolicyResponse> createPolicy(@Valid @RequestBody CreatePolicyRequest request) {
        PolicyResponse response = policyService.createPolicy(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @GetMapping
    public ResponseEntity<List<PolicyResponse>> listPolicies() {
        return ResponseEntity.ok(policyService.listPolicies());
    }

    @GetMapping("/{id}")
    public ResponseEntity<PolicyResponse> getPolicy(@PathVariable UUID id) {
        return ResponseEntity.ok(policyService.getPolicy(id));
    }

    @PutMapping("/{id}")
    @RequiresPermission("policy:create")
    public ResponseEntity<PolicyResponse> updatePolicy(@PathVariable UUID id,
                                                        @Valid @RequestBody CreatePolicyRequest request) {
        return ResponseEntity.ok(policyService.updatePolicy(id, request));
    }

    @DeleteMapping("/{id}")
    @RequiresPermission("policy:create")
    public ResponseEntity<Void> deletePolicy(@PathVariable UUID id) {
        policyService.deletePolicy(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/attach")
    @RequiresPermission("policy:attach")
    public ResponseEntity<Void> attachPolicy(@Valid @RequestBody AttachPolicyRequest request) {
        policyService.attachPolicy(request);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    // Also accept POST /v1/policies/attachments for frontend compatibility
    @PostMapping("/attachments")
    @RequiresPermission("policy:attach")
    public ResponseEntity<Void> attachPolicyAlt(@Valid @RequestBody AttachPolicyRequest request) {
        policyService.attachPolicy(request);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @GetMapping("/attachments")
    public ResponseEntity<List<PolicyAttachmentResponse>> listAttachments() {
        return ResponseEntity.ok(policyService.listAllAttachments());
    }

    @GetMapping("/attachments/api/{apiId}")
    public ResponseEntity<List<PolicyAttachmentResponse>> getAttachmentsForApi(@PathVariable UUID apiId) {
        return ResponseEntity.ok(policyService.getAttachmentsForApi(apiId));
    }

    @DeleteMapping("/attachments/{id}")
    @RequiresPermission("policy:detach")
    public ResponseEntity<Void> detachPolicy(@PathVariable UUID id) {
        policyService.detachPolicy(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/api/{apiId}")
    public ResponseEntity<List<PolicyResponse>> getPoliciesForApi(@PathVariable UUID apiId) {
        return ResponseEntity.ok(policyService.getPoliciesForApi(apiId));
    }

    @GetMapping("/templates")
    public ResponseEntity<List<TransformTemplateProvider.TransformTemplate>> getTransformTemplates() {
        return ResponseEntity.ok(transformTemplateProvider.getTemplates());
    }
}

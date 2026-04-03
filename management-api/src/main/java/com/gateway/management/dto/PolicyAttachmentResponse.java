package com.gateway.management.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PolicyAttachmentResponse {
    private UUID id;
    private UUID policyId;
    private String policyName;
    private String policyType;
    private UUID apiId;
    private String apiName;
    private UUID routeId;
    private String routePath;
    private String scope;
    private Integer priority;
}

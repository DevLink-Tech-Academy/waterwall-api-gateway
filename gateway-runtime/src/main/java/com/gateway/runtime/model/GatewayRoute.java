package com.gateway.runtime.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

/**
 * Read-only POJO representing a cached route definition.
 * Loaded from the gateway.routes table via JdbcTemplate.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GatewayRoute {

    private UUID routeId;
    private UUID apiId;
    private String apiName;
    private String path;
    private String method;
    private String upstreamUrl;
    private List<String> authTypes;
    private int priority;
    private boolean stripPrefix;
    private boolean enabled;
    private String protocolType;
}

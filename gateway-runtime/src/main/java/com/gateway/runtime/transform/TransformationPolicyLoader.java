package com.gateway.runtime.transform;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Loads TRANSFORM-type policies from the database, keyed by API ID and route ID.
 * Refreshes on config.refresh RabbitMQ events and periodically.
 */
@Slf4j
@Service
public class TransformationPolicyLoader {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    // Keyed by apiId -> list of transformation configs
    private volatile Map<UUID, List<TransformationConfig>> configsByApiId = Map.of();
    // Keyed by routeId -> list of transformation configs
    private volatile Map<UUID, List<TransformationConfig>> configsByRouteId = Map.of();

    public TransformationPolicyLoader(JdbcTemplate gatewayJdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = gatewayJdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    public void loadAll() {
        reload();
    }

    @RabbitListener(queues = "#{transformRefreshQueue.name}")
    public void onConfigRefresh(Object message) {
        log.info("Transform policies: received config.refresh event — reloading");
        reload();
    }

    @Scheduled(fixedDelay = 30_000, initialDelay = 35_000)
    public void scheduledRefresh() {
        reload();
    }

    public List<TransformationConfig> getConfigsForApi(UUID apiId) {
        return configsByApiId.getOrDefault(apiId, List.of());
    }

    public List<TransformationConfig> getConfigsForRoute(UUID routeId) {
        return configsByRouteId.getOrDefault(routeId, List.of());
    }

    /**
     * Get all applicable transformation configs for a given API + route combination.
     * Returns route-level configs first (higher specificity), then API-level.
     */
    public List<TransformationConfig> getConfigs(UUID apiId, UUID routeId) {
        List<TransformationConfig> result = new ArrayList<>();
        if (routeId != null) {
            result.addAll(configsByRouteId.getOrDefault(routeId, List.of()));
        }
        result.addAll(configsByApiId.getOrDefault(apiId, List.of()));
        return result;
    }

    private void reload() {
        try {
            String sql = """
                    SELECT pa.api_id, pa.route_id, p.config, pa.priority
                    FROM gateway.policies p
                    JOIN gateway.policy_attachments pa ON pa.policy_id = p.id
                    WHERE p.type = 'TRANSFORM'
                    ORDER BY pa.priority ASC
                    """;

            Map<UUID, List<TransformationConfig>> byApi = new ConcurrentHashMap<>();
            Map<UUID, List<TransformationConfig>> byRoute = new ConcurrentHashMap<>();

            jdbcTemplate.query(sql, (rs, rowNum) -> {
                String configJson = rs.getString("config");
                UUID apiId = rs.getObject("api_id", UUID.class);
                UUID routeId = rs.getObject("route_id", UUID.class);

                if (configJson == null || configJson.isBlank()) return null;

                try {
                    TransformationConfig config = objectMapper.readValue(configJson, TransformationConfig.class);
                    if (routeId != null) {
                        byRoute.computeIfAbsent(routeId, k -> new ArrayList<>()).add(config);
                    } else if (apiId != null) {
                        byApi.computeIfAbsent(apiId, k -> new ArrayList<>()).add(config);
                    }
                } catch (Exception e) {
                    log.warn("Failed to parse TRANSFORM policy config: {}", e.getMessage());
                }
                return null;
            });

            this.configsByApiId = byApi;
            this.configsByRouteId = byRoute;

            int total = byApi.values().stream().mapToInt(List::size).sum()
                      + byRoute.values().stream().mapToInt(List::size).sum();
            log.info("Loaded {} transformation policies ({} API-level, {} route-level)",
                    total, byApi.size(), byRoute.size());

        } catch (Exception e) {
            log.warn("Failed to load transformation policies (table may not exist yet): {}", e.getMessage());
        }
    }
}

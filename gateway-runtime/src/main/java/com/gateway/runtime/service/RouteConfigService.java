package com.gateway.runtime.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.runtime.config.ConfigRefreshRabbitConfig;
import com.gateway.runtime.model.GatewayPlan;
import com.gateway.runtime.model.GatewayRoute;
import com.gateway.runtime.model.GatewaySubscription;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * Loads route, plan, and subscription configuration from the gateway schema
 * into in-memory caches. Listens on the {@code config.refresh} fanout exchange
 * to reload configuration when the management-api publishes changes.
 */
@Service
public class RouteConfigService {

    private static final Logger log = LoggerFactory.getLogger(RouteConfigService.class);

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    // ── In-memory stores ────────────────────────────────────────────────
    private volatile List<GatewayRoute> routes = List.of();
    private volatile Map<UUID, GatewayPlan> plansById = Map.of();
    private volatile Map<UUID, List<GatewaySubscription>> subscriptionsByApp = Map.of();
    // Keyed by "appId:apiId" for fast lookup
    private volatile Map<String, GatewaySubscription> subscriptionIndex = Map.of();
    // Per-API gateway_config JSONB keyed by api ID
    private volatile Map<UUID, String> gatewayConfigByApiId = Map.of();

    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();

    // ── Config versioning ────────────────────────────────────────────────
    private final AtomicLong configVersion = new AtomicLong(0);
    private volatile Instant lastReloadTime;

    public RouteConfigService(JdbcTemplate gatewayJdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = gatewayJdbcTemplate;
        this.objectMapper = objectMapper;
    }

    // ── Initialisation ──────────────────────────────────────────────────

    @PostConstruct
    public void loadAllConfig() {
        long startMs = System.currentTimeMillis();
        log.info("Loading gateway configuration from database...");
        try {
            List<GatewayRoute> loadedRoutes = loadRoutes();
            Map<UUID, GatewayPlan> loadedPlans = loadPlans();
            Map<UUID, List<GatewaySubscription>> loadedSubsByApp = new ConcurrentHashMap<>();
            Map<String, GatewaySubscription> loadedSubIndex = new ConcurrentHashMap<>();
            loadSubscriptions(loadedSubsByApp, loadedSubIndex);
            Map<UUID, String> loadedGatewayConfigs = loadGatewayConfigs();

            // Atomic swap of volatile references — no lock needed for readers
            // Volatile guarantees visibility; all data is fully constructed before assignment
            this.routes = List.copyOf(loadedRoutes);
            this.plansById = Map.copyOf(loadedPlans);
            this.subscriptionsByApp = Map.copyOf(loadedSubsByApp);
            this.subscriptionIndex = Map.copyOf(loadedSubIndex);
            this.gatewayConfigByApiId = Map.copyOf(loadedGatewayConfigs);

            long version = configVersion.incrementAndGet();
            lastReloadTime = Instant.now();
            long elapsedMs = System.currentTimeMillis() - startMs;

            log.info("Gateway configuration loaded (v{}): {} routes, {} plans, {} subscriptions in {}ms",
                    version, loadedRoutes.size(), loadedPlans.size(), loadedSubIndex.size(), elapsedMs);
        } catch (Exception e) {
            log.error("Failed to load gateway configuration from database", e);
            throw e;
        }
    }

    // ── RabbitMQ listener ───────────────────────────────────────────────

    @RabbitListener(queues = "#{configRefreshQueue.name}")
    public void onConfigRefresh(Object message) {
        log.info("Received config.refresh event — reloading all gateway configuration");
        loadAllConfig();
    }

    /**
     * Periodic auto-refresh every 30 seconds to pick up new routes, subscriptions, and plans
     * without requiring RabbitMQ events or manual refresh.
     */
    @Scheduled(fixedDelay = 30_000, initialDelay = 30_000)
    public void scheduledRefresh() {
        log.debug("Scheduled config refresh");
        loadAllConfig();
    }

    // ── Public accessors ────────────────────────────────────────────────

    public List<GatewayRoute> getAllRoutes() {
        // No lock needed — volatile references to immutable collections
        return routes;
    }

    public Map<UUID, GatewayPlan> getPlansById() {
        return plansById;
    }

    public List<GatewaySubscription> getSubscriptionsForApp(UUID applicationId) {
        return subscriptionsByApp.getOrDefault(applicationId, List.of());
    }

    public Optional<GatewaySubscription> getSubscription(UUID appId, UUID apiId) {
        String key = appId.toString() + ":" + apiId.toString();
        return Optional.ofNullable(subscriptionIndex.get(key));
    }

    public Optional<GatewaySubscription> getSubscription(UUID appId, UUID apiId, String environmentSlug) {
        // Try environment-specific match first
        if (environmentSlug != null) {
            String envKey = appId.toString() + ":" + apiId.toString() + ":" + environmentSlug;
            GatewaySubscription envSub = subscriptionIndex.get(envKey);
            if (envSub != null) return Optional.of(envSub);
        }
        // Fall back to non-environment match
        String key = appId.toString() + ":" + apiId.toString();
        return Optional.ofNullable(subscriptionIndex.get(key));
    }

    public long getConfigVersion() {
        return configVersion.get();
    }

    public Instant getLastReloadTime() {
        return lastReloadTime;
    }

    public int getRouteCount() {
        return routes.size();
    }

    public int getPlanCount() {
        return plansById.size();
    }

    public int getSubscriptionCount() {
        return subscriptionIndex.size();
    }

    /**
     * Return the raw gateway_config JSON for a given API ID, or null if not present.
     */
    public String getGatewayConfig(UUID apiId) {
        return gatewayConfigByApiId.get(apiId);
    }

    // ── Private loaders ─────────────────────────────────────────────────

    private Map<UUID, String> loadGatewayConfigs() {
        String sql = "SELECT id, gateway_config FROM gateway.apis WHERE gateway_config IS NOT NULL";
        Map<UUID, String> result = new ConcurrentHashMap<>();
        try {
            jdbcTemplate.query(sql, (rs, rowNum) -> {
                UUID apiId = rs.getObject("id", UUID.class);
                String config = rs.getString("gateway_config");
                if (config != null && !config.isBlank()) {
                    result.put(apiId, config);
                }
                return null;
            });
        } catch (Exception e) {
            log.warn("Failed to load gateway_config from apis table (column may not exist yet): {}", e.getMessage());
        }
        return result;
    }

    private List<GatewayRoute> loadRoutes() {
        String sql = """
                SELECT r.id, r.api_id, a.name as api_name, a.context_path, a.version as api_version,
                       r.path, r.method, r.upstream_url,
                       r.auth_types, r.priority, r.strip_prefix, r.enabled,
                       a.backend_base_url, a.status as api_status
                FROM gateway.routes r
                JOIN gateway.apis a ON a.id = r.api_id
                WHERE r.enabled = true
                  AND a.status IN ('PUBLISHED', 'CREATED', 'DRAFT')
                ORDER BY r.priority DESC
                """;

        return jdbcTemplate.query(sql, (rs, rowNum) -> {
            List<String> authTypes = parseJsonStringList(rs.getString("auth_types"));
            String upstreamUrl = rs.getString("upstream_url");
            String backendBaseUrl = rs.getString("backend_base_url");

            // Resolve full upstream: if route has a relative path, prepend backend_base_url
            if (backendBaseUrl != null && !backendBaseUrl.isBlank()) {
                if (upstreamUrl == null || !upstreamUrl.startsWith("http")) {
                    // Route stores path only — combine with backend base URL
                    String path = upstreamUrl != null ? upstreamUrl : rs.getString("path");
                    if (!path.startsWith("/")) path = "/" + path;
                    upstreamUrl = backendBaseUrl.replaceAll("/+$", "") + path;
                }
            }

            return GatewayRoute.builder()
                    .routeId(rs.getObject("id", UUID.class))
                    .apiId(rs.getObject("api_id", UUID.class))
                    .apiName(rs.getString("api_name"))
                    .path(buildGatewayPath(rs.getString("context_path"), rs.getString("api_version"), rs.getString("path")))
                    .contextPath(rs.getString("context_path"))
                    .apiVersion(rs.getString("api_version"))
                    .method(rs.getString("method"))
                    .upstreamUrl(upstreamUrl)
                    .authTypes(authTypes)
                    .priority(rs.getInt("priority"))
                    .stripPrefix(rs.getBoolean("strip_prefix"))
                    .enabled(rs.getBoolean("enabled"))
                    .build();
        });
    }

    private Map<UUID, GatewayPlan> loadPlans() {
        String sql = """
                SELECT id, name, description, rate_limits, quota, enforcement, status
                FROM gateway.plans
                WHERE status = 'ACTIVE'
                """;

        Map<UUID, GatewayPlan> result = new ConcurrentHashMap<>();
        jdbcTemplate.query(sql, (rs, rowNum) -> {
            UUID planId = rs.getObject("id", UUID.class);
            String rateLimitsJson = rs.getString("rate_limits");
            String quotaJson = rs.getString("quota");
            String enforcement = rs.getString("enforcement");

            GatewayPlan.GatewayPlanBuilder builder = GatewayPlan.builder()
                    .planId(planId)
                    .name(rs.getString("name"))
                    .enforcement(enforcement);

            // Parse rate_limits JSON: {"requestsPerSecond": 10, "requestsPerMinute": 100, ...}
            if (rateLimitsJson != null) {
                try {
                    JsonNode rateLimits = objectMapper.readTree(rateLimitsJson);
                    if (rateLimits.has("requestsPerSecond")) {
                        builder.requestsPerSecond(rateLimits.get("requestsPerSecond").asInt());
                    }
                    if (rateLimits.has("requestsPerMinute")) {
                        builder.requestsPerMinute(rateLimits.get("requestsPerMinute").asInt());
                    }
                    if (rateLimits.has("requestsPerDay")) {
                        builder.requestsPerDay(rateLimits.get("requestsPerDay").asInt());
                    }
                    if (rateLimits.has("burstAllowance")) {
                        builder.burstAllowance(rateLimits.get("burstAllowance").asInt());
                    }
                } catch (Exception e) {
                    log.warn("Failed to parse rate_limits JSON for plan {}: {}", planId, e.getMessage());
                }
            }

            // Parse quota JSON: {"maxRequestsPerMonth": 100000} or {"monthlyRequests": 10000}
            if (quotaJson != null) {
                try {
                    JsonNode quota = objectMapper.readTree(quotaJson);
                    if (quota.has("maxRequestsPerMonth")) {
                        builder.maxRequestsPerMonth(quota.get("maxRequestsPerMonth").asLong());
                    } else if (quota.has("monthlyRequests")) {
                        builder.maxRequestsPerMonth(quota.get("monthlyRequests").asLong());
                    }
                } catch (Exception e) {
                    log.warn("Failed to parse quota JSON for plan {}: {}", planId, e.getMessage());
                }
            }

            GatewayPlan plan = builder.build();
            result.put(planId, plan);
            return plan;
        });
        return result;
    }

    private void loadSubscriptions(Map<UUID, List<GatewaySubscription>> byApp,
                                   Map<String, GatewaySubscription> index) {
        String sql = """
                SELECT id, application_id, api_id, plan_id, status, environment_slug
                FROM gateway.subscriptions
                WHERE status IN ('APPROVED', 'ACTIVE')
                """;

        jdbcTemplate.query(sql, (rs, rowNum) -> {
            String envSlug = rs.getString("environment_slug");
            GatewaySubscription sub = GatewaySubscription.builder()
                    .subscriptionId(rs.getObject("id", UUID.class))
                    .applicationId(rs.getObject("application_id", UUID.class))
                    .apiId(rs.getObject("api_id", UUID.class))
                    .planId(rs.getObject("plan_id", UUID.class))
                    .status(rs.getString("status"))
                    .environmentSlug(envSlug)
                    .build();

            byApp.computeIfAbsent(sub.getApplicationId(), k -> new ArrayList<>()).add(sub);
            // Index by app:api (backwards compatible)
            index.put(sub.getApplicationId().toString() + ":" + sub.getApiId().toString(), sub);
            // Also index by app:api:env (environment-specific)
            if (envSlug != null) {
                index.put(sub.getApplicationId().toString() + ":" + sub.getApiId().toString() + ":" + envSlug, sub);
            }
            return sub;
        });
    }

    /**
     * Builds the full gateway path: /{context_path}/{version}/{route_path}
     * Falls back gracefully if context_path or version is missing.
     */
    private String buildGatewayPath(String contextPath, String version, String routePath) {
        StringBuilder sb = new StringBuilder();
        if (contextPath != null && !contextPath.isBlank()) {
            if (!contextPath.startsWith("/")) sb.append("/");
            sb.append(contextPath);
        }
        // Note: API version is NOT included in the gateway path.
        // Routes already contain their own version prefixes (e.g. /v1/orders).
        // The API 'version' field is metadata, not a URL component.
        if (routePath != null) {
            if (!routePath.startsWith("/")) sb.append("/");
            sb.append(routePath);
        }
        String result = sb.toString();
        // Normalize double slashes
        result = result.replaceAll("/+", "/");
        if (result.isEmpty()) result = "/";
        return result;
    }

    private List<String> parseJsonStringList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            log.warn("Failed to parse JSON string list: {}", e.getMessage());
            return List.of();
        }
    }
}

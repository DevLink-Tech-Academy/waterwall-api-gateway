package com.gateway.management.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.common.auth.SecurityContextHelper;
import com.gateway.management.dto.ImportApiResult;
import com.gateway.management.dto.ImportApiResult.ImportedChannel;
import com.gateway.management.dto.ImportApiResult.ImportedRoute;
import com.gateway.management.entity.ApiEntity;
import com.gateway.management.entity.ApiSpecEntity;
import com.gateway.management.entity.RouteEntity;
import com.gateway.management.entity.enums.ApiStatus;
import com.gateway.management.entity.enums.Sensitivity;
import com.gateway.management.entity.enums.VersionStatus;
import com.gateway.management.entity.enums.Visibility;
import com.gateway.management.repository.ApiRepository;
import com.gateway.management.repository.ApiSpecRepository;
import com.gateway.management.repository.RouteRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class ImportService {

    private final ApiRepository apiRepository;
    private final RouteRepository routeRepository;
    private final ApiSpecRepository apiSpecRepository;
    private final ObjectMapper objectMapper;

    // ── Format Detection ────────────────────────────────────────────

    public String detectFormat(String content, String filename) {
        if (content == null || content.isBlank()) return "UNKNOWN";

        String trimmed = content.trim();

        // JSON-based detection
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
                JsonNode root = objectMapper.readTree(trimmed);

                if (root.has("openapi")) return "OPENAPI_3";
                if (root.has("swagger")) return "SWAGGER_2";
                if (root.has("asyncapi")) return "ASYNCAPI";
                if (root.has("openrpc")) return "OPENRPC";

                // Postman collection
                if (root.has("info") && root.has("item")) return "POSTMAN";

                // HAR
                if (root.has("log") && root.path("log").has("entries")) return "HAR";

                // OData CSDL JSON
                if (root.has("$Version") || root.has("$EntityContainer")) return "ODATA_EDMX";

            } catch (Exception ignored) {}
        }

        // YAML-based detection
        if (trimmed.contains("openapi:") || trimmed.contains("openapi :")) return "OPENAPI_3";
        if (trimmed.contains("swagger:") || trimmed.contains("swagger :")) return "SWAGGER_2";
        if (trimmed.contains("asyncapi:") || trimmed.contains("asyncapi :")) return "ASYNCAPI";

        // XML-based detection
        if (trimmed.startsWith("<") || trimmed.contains("<?xml")) {
            if (trimmed.contains("definitions") && trimmed.contains("wsdl")) return "WSDL";
            if (trimmed.contains("edmx:Edmx") || trimmed.contains("edmx:DataServices")) return "ODATA_EDMX";
        }

        // GraphQL SDL
        if (trimmed.contains("type Query") || trimmed.contains("type Mutation") || trimmed.contains("schema {")) return "GRAPHQL_SDL";

        // Protobuf
        if (trimmed.contains("syntax = \"proto") || (trimmed.contains("service ") && trimmed.contains("rpc "))) return "PROTOBUF";

        // Filename-based fallback
        if (filename != null) {
            String lower = filename.toLowerCase();
            if (lower.endsWith(".proto")) return "PROTOBUF";
            if (lower.endsWith(".wsdl")) return "WSDL";
            if (lower.endsWith(".graphql") || lower.endsWith(".gql")) return "GRAPHQL_SDL";
            if (lower.endsWith(".har")) return "HAR";
        }

        return "UNKNOWN";
    }

    // ── Parse (dispatch to correct parser) ──────────────────────────

    public ImportApiResult parse(String content, String format) {
        return switch (format) {
            case "OPENAPI_3" -> parseOpenApi3(content);
            case "SWAGGER_2" -> parseSwagger2(content);
            case "ASYNCAPI" -> parseAsyncApi(content);
            case "GRAPHQL_SDL" -> parseGraphQL(content);
            case "PROTOBUF" -> parseProtobuf(content);
            case "WSDL" -> parseWsdl(content);
            case "POSTMAN" -> parsePostman(content);
            case "OPENRPC" -> parseOpenRpc(content);
            case "ODATA_EDMX" -> parseOData(content);
            case "HAR" -> parseHar(content);
            default -> {
                var result = ImportApiResult.builder().build();
                result.getWarnings().add("Unknown format: " + format);
                yield result;
            }
        };
    }

    // ── Import (parse + create entities) ────────────────────────────

    @Transactional
    public ApiEntity importApi(ImportApiResult result, String sensitivity, String category) {
        String currentUserId = SecurityContextHelper.getCurrentUserId();
        String currentOrgId = SecurityContextHelper.getCurrentOrgId();

        // Create API entity
        ApiEntity api = ApiEntity.builder()
                .name(result.getName() != null ? result.getName() : "Imported API")
                .version(result.getVersion() != null ? result.getVersion() : "1.0.0")
                .description(result.getDescription())
                .status(ApiStatus.DRAFT)
                .visibility(Visibility.PUBLIC)
                .protocolType(result.getProtocolType() != null ? result.getProtocolType() : "REST")
                .tags(result.getTags())
                .category(category)
                .sensitivity(sensitivity != null ? Sensitivity.valueOf(sensitivity) : Sensitivity.LOW)
                .versionStatus(VersionStatus.DRAFT)
                .authMode(result.getAuthSchemes().isEmpty() ? "NONE" : "REQUIRED")
                .allowAnonymous(result.getAuthSchemes().isEmpty())
                .createdBy(currentUserId != null ? UUID.fromString(currentUserId) : null)
                .orgId(currentOrgId != null ? UUID.fromString(currentOrgId) : null)
                .build();

        // Auto-generate context path from API name
        String contextPath = null;
        if (contextPath == null || contextPath.isBlank()) {
            contextPath = api.getName().toLowerCase()
                    .replaceAll("[^a-z0-9]+", "-")
                    .replaceAll("(^-|-$)", "");
            if (contextPath.isEmpty()) contextPath = "api-" + java.util.UUID.randomUUID().toString().substring(0, 8);
        }
        api.setContextPath(contextPath);

        ApiEntity saved = apiRepository.save(api);
        saved.setApiGroupId(saved.getId());
        saved.setApiGroupName(saved.getName());
        saved = apiRepository.save(saved);

        // Set backend base URL from spec servers (editable at API level)
        String baseUpstream = result.getServers().isEmpty()
                ? "http://localhost:8090"
                : result.getServers().get(0).replaceAll("/+$", "");
        saved.setBackendBaseUrl(baseUpstream);
        saved = apiRepository.save(saved);

        // Create routes with path only (no domain — upstream resolved from backendBaseUrl + path)
        for (ImportedRoute route : result.getRoutes()) {
            String path = route.getPath();
            if (!path.startsWith("/")) path = "/" + path;

            RouteEntity routeEntity = RouteEntity.builder()
                    .api(saved)
                    .path(path)
                    .method(route.getMethod() != null ? route.getMethod() : "GET")
                    .upstreamUrl(path) // path only — runtime resolves full URL via API.backendBaseUrl + path
                    .authTypes(route.getAuthTypes() != null ? route.getAuthTypes() : result.getAuthSchemes())
                    .priority(10)
                    .stripPrefix(false)
                    .enabled(true)
                    .build();
            routeRepository.save(routeEntity);
        }

        // Store spec
        if (result.getRawSpec() != null && !result.getRawSpec().isBlank()) {
            ApiSpecEntity spec = ApiSpecEntity.builder()
                    .apiId(saved.getId())
                    .specContent(result.getRawSpec())
                    .specFormat(result.getDetectedFormat() != null ? result.getDetectedFormat() : "OPENAPI_3")
                    .build();
            apiSpecRepository.save(spec);
        }

        log.info("API imported: id={}, name={}, protocol={}, routes={}",
                saved.getId(), saved.getName(), saved.getProtocolType(), result.getRoutes().size());

        return saved;
    }

    // ════════════════════════════════════════════════════════════════
    //  PARSERS
    // ════════════════════════════════════════════════════════════════

    // ── OpenAPI 3.x ─────────────────────────────────────────────────

    private ImportApiResult parseOpenApi3(String content) {
        var result = ImportApiResult.builder().detectedFormat("OPENAPI_3").protocolType("REST").rawSpec(content).build();
        try {
            JsonNode root = readJsonOrYaml(content);
            JsonNode info = root.path("info");

            result.setName(info.path("title").asText("Imported API"));
            result.setVersion(info.path("version").asText("1.0.0"));
            result.setDescription(info.path("description").asText(""));

            // Servers
            if (root.has("servers")) {
                for (JsonNode server : root.path("servers")) {
                    result.getServers().add(server.path("url").asText());
                }
            }

            // Security schemes
            JsonNode schemes = root.path("components").path("securitySchemes");
            if (schemes.isObject()) {
                schemes.fields().forEachRemaining(entry -> {
                    String type = entry.getValue().path("type").asText();
                    switch (type) {
                        case "apiKey" -> result.getAuthSchemes().add("API_KEY");
                        case "http" -> {
                            if ("bearer".equals(entry.getValue().path("scheme").asText()))
                                result.getAuthSchemes().add("OAUTH2");
                            else result.getAuthSchemes().add("BASIC");
                        }
                        case "oauth2" -> result.getAuthSchemes().add("OAUTH2");
                        case "mutualTLS" -> result.getAuthSchemes().add("MTLS");
                    }
                });
            }

            // Tags
            if (root.has("tags")) {
                for (JsonNode tag : root.path("tags")) {
                    result.getTags().add(tag.path("name").asText());
                }
            }

            // Paths → Routes
            JsonNode paths = root.path("paths");
            if (paths.isObject()) {
                paths.fields().forEachRemaining(pathEntry -> {
                    String path = pathEntry.getKey();
                    JsonNode methods = pathEntry.getValue();
                    methods.fields().forEachRemaining(methodEntry -> {
                        String method = methodEntry.getKey().toUpperCase();
                        if (List.of("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS").contains(method)) {
                            JsonNode op = methodEntry.getValue();
                            result.getRoutes().add(ImportedRoute.builder()
                                    .path(path)
                                    .method(method)
                                    .description(op.path("summary").asText(op.path("description").asText("")))
                                    .build());
                        }
                    });
                });
            }

            if (result.getRoutes().isEmpty()) result.getWarnings().add("No paths/endpoints found in spec");
        } catch (Exception e) {
            result.getWarnings().add("Parse error: " + e.getMessage());
        }
        return result;
    }

    // ── Swagger 2.0 ─────────────────────────────────────────────────

    private ImportApiResult parseSwagger2(String content) {
        var result = ImportApiResult.builder().detectedFormat("SWAGGER_2").protocolType("REST").rawSpec(content).build();
        try {
            JsonNode root = readJsonOrYaml(content);
            JsonNode info = root.path("info");

            result.setName(info.path("title").asText("Imported API"));
            result.setVersion(info.path("version").asText("1.0.0"));
            result.setDescription(info.path("description").asText(""));

            // Host + basePath
            String host = root.path("host").asText("");
            String basePath = root.path("basePath").asText("");
            if (!host.isEmpty()) {
                String scheme = root.has("schemes") && root.path("schemes").size() > 0
                        ? root.path("schemes").get(0).asText("https") : "https";
                result.getServers().add(scheme + "://" + host + basePath);
            }

            // Security definitions
            JsonNode secDefs = root.path("securityDefinitions");
            if (secDefs.isObject()) {
                secDefs.fields().forEachRemaining(entry -> {
                    String type = entry.getValue().path("type").asText();
                    switch (type) {
                        case "apiKey" -> result.getAuthSchemes().add("API_KEY");
                        case "basic" -> result.getAuthSchemes().add("BASIC");
                        case "oauth2" -> result.getAuthSchemes().add("OAUTH2");
                    }
                });
            }

            // Paths
            JsonNode paths = root.path("paths");
            if (paths.isObject()) {
                paths.fields().forEachRemaining(pathEntry -> {
                    String path = pathEntry.getKey();
                    pathEntry.getValue().fields().forEachRemaining(methodEntry -> {
                        String method = methodEntry.getKey().toUpperCase();
                        if (List.of("GET", "POST", "PUT", "DELETE", "PATCH").contains(method)) {
                            JsonNode op = methodEntry.getValue();
                            result.getRoutes().add(ImportedRoute.builder()
                                    .path(path).method(method)
                                    .description(op.path("summary").asText(""))
                                    .build());
                        }
                    });
                });
            }

            result.getWarnings().add("Swagger 2.0 detected — consider upgrading to OpenAPI 3.x");
        } catch (Exception e) {
            result.getWarnings().add("Parse error: " + e.getMessage());
        }
        return result;
    }

    // ── AsyncAPI (Kafka, MQTT, WebSocket, SSE, RabbitMQ) ────────────

    private ImportApiResult parseAsyncApi(String content) {
        var result = ImportApiResult.builder().detectedFormat("ASYNCAPI").rawSpec(content).build();
        try {
            JsonNode root = readJsonOrYaml(content);
            JsonNode info = root.path("info");

            result.setName(info.path("title").asText("Imported Event API"));
            result.setVersion(info.path("version").asText("1.0.0"));
            result.setDescription(info.path("description").asText(""));

            // Detect protocol from servers
            String protocol = "WEBSOCKET";
            JsonNode servers = root.path("servers");
            if (servers.isObject() && servers.fields().hasNext()) {
                var first = servers.fields().next();
                String proto = first.getValue().path("protocol").asText("").toLowerCase();
                protocol = switch (proto) {
                    case "kafka" -> "KAFKA";
                    case "amqp", "amqps" -> "RABBITMQ";
                    case "mqtt", "mqtts" -> "MQTT";
                    case "ws", "wss" -> "WEBSOCKET";
                    case "sse" -> "SSE";
                    default -> "WEBSOCKET";
                };
                result.getServers().add(first.getValue().path("url").asText());
            }
            result.setProtocolType(protocol);
            final String finalProtocol = protocol;

            // Channels
            JsonNode channels = root.path("channels");
            if (channels.isObject()) {
                channels.fields().forEachRemaining(entry -> {
                    String channelName = entry.getKey();
                    JsonNode channel = entry.getValue();

                    result.getChannels().add(ImportedChannel.builder()
                            .name(channelName)
                            .protocol(finalProtocol)
                            .description(channel.path("description").asText(""))
                            .build());

                    // Also create a route for HTTP-based protocols
                    if ("WEBSOCKET".equals(finalProtocol) || "SSE".equals(finalProtocol)) {
                        result.getRoutes().add(ImportedRoute.builder()
                                .path(channelName.startsWith("/") ? channelName : "/" + channelName)
                                .method("WEBSOCKET".equals(finalProtocol) ? "WS" : "GET")
                                .description(channel.path("description").asText(""))
                                .build());
                    }
                });
            }

            if (result.getChannels().isEmpty()) result.getWarnings().add("No channels found in AsyncAPI spec");
        } catch (Exception e) {
            result.getWarnings().add("Parse error: " + e.getMessage());
        }
        return result;
    }

    // ── GraphQL SDL ─────────────────────────────────────────────────

    private ImportApiResult parseGraphQL(String content) {
        var result = ImportApiResult.builder()
                .detectedFormat("GRAPHQL_SDL").protocolType("GRAPHQL").rawSpec(content).build();

        result.setName("GraphQL API");
        result.setVersion("1.0.0");

        // Single POST /graphql route
        result.getRoutes().add(ImportedRoute.builder()
                .path("/graphql").method("POST").description("GraphQL endpoint").build());

        // Parse type Query and type Mutation for documentation
        List<String> operations = new ArrayList<>();
        String[] lines = content.split("\n");
        boolean inQuery = false, inMutation = false, inSubscription = false;
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.startsWith("type Query")) inQuery = true;
            else if (trimmed.startsWith("type Mutation")) inMutation = true;
            else if (trimmed.startsWith("type Subscription")) inSubscription = true;
            else if (trimmed.equals("}")) { inQuery = false; inMutation = false; inSubscription = false; }
            else if ((inQuery || inMutation || inSubscription) && trimmed.contains("(") || trimmed.contains(":")) {
                String opName = trimmed.split("[:(]")[0].trim();
                if (!opName.isEmpty() && !opName.startsWith("#") && !opName.startsWith("\"")) {
                    String prefix = inQuery ? "Query" : inMutation ? "Mutation" : "Subscription";
                    operations.add(prefix + "." + opName);
                }
            }
        }

        result.setDescription("GraphQL API with " + operations.size() + " operations: " + String.join(", ", operations.subList(0, Math.min(5, operations.size()))));
        if (operations.isEmpty()) result.getWarnings().add("No Query/Mutation types found in SDL");

        // Add operations as tags
        result.setTags(List.of("graphql"));

        return result;
    }

    // ── gRPC / Protobuf ─────────────────────────────────────────────

    private ImportApiResult parseProtobuf(String content) {
        var result = ImportApiResult.builder()
                .detectedFormat("PROTOBUF").protocolType("GRPC").rawSpec(content).build();

        result.setVersion("1.0.0");

        // Parse package name
        String packageName = "";
        for (String line : content.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.startsWith("package ")) {
                packageName = trimmed.replace("package ", "").replace(";", "").trim();
                break;
            }
        }

        // Parse services and rpc methods
        List<String> services = new ArrayList<>();
        String currentService = null;

        for (String line : content.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.startsWith("service ")) {
                currentService = trimmed.split("\\s+")[1].replace("{", "").trim();
                services.add(currentService);
            } else if (trimmed.startsWith("rpc ") && currentService != null) {
                String methodName = trimmed.split("\\s+")[1].split("\\(")[0].trim();
                String fullPath = "/" + (packageName.isEmpty() ? "" : packageName + ".") + currentService + "/" + methodName;
                result.getRoutes().add(ImportedRoute.builder()
                        .path(fullPath).method("POST").description("gRPC method: " + methodName).build());
            } else if (trimmed.equals("}")) {
                currentService = null;
            }
        }

        result.setName(services.isEmpty() ? "gRPC API" : services.get(0) + " Service");
        result.setTags(List.of("grpc"));

        if (result.getRoutes().isEmpty()) result.getWarnings().add("No service/rpc definitions found");

        return result;
    }

    // ── WSDL (SOAP) ─────────────────────────────────────────────────

    private ImportApiResult parseWsdl(String content) {
        var result = ImportApiResult.builder()
                .detectedFormat("WSDL").protocolType("SOAP").rawSpec(content).build();

        result.setVersion("1.0.0");

        // Simple XML parsing for WSDL (no full XML parser to avoid dependencies)
        String serviceName = extractXmlAttr(content, "service", "name");
        result.setName(serviceName != null ? serviceName : "SOAP Service");

        // Extract operations from portType/binding
        List<String> operations = new ArrayList<>();
        String[] lines = content.split("\n");
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.contains("<operation") || trimmed.contains("<wsdl:operation")) {
                String opName = extractXmlAttr(trimmed, "operation", "name");
                if (opName != null) {
                    operations.add(opName);
                    result.getRoutes().add(ImportedRoute.builder()
                            .path("/" + opName).method("POST")
                            .description("SOAP operation: " + opName).build());
                }
            }
        }

        // Extract endpoint from service/port/address
        for (String line : lines) {
            if (line.contains("location=")) {
                String loc = line.substring(line.indexOf("location=\"") + 10);
                loc = loc.substring(0, loc.indexOf("\""));
                result.getServers().add(loc);
                break;
            }
        }

        result.setDescription("SOAP service with " + operations.size() + " operations");
        result.setTags(List.of("soap", "xml"));

        if (operations.isEmpty()) result.getWarnings().add("No operations found in WSDL");

        return result;
    }

    // ── Postman Collection ──────────────────────────────────────────

    private ImportApiResult parsePostman(String content) {
        var result = ImportApiResult.builder()
                .detectedFormat("POSTMAN").protocolType("REST").rawSpec(content).build();
        try {
            JsonNode root = objectMapper.readTree(content);
            JsonNode info = root.path("info");

            result.setName(info.path("name").asText("Postman Collection"));
            result.setDescription(info.path("description").asText(""));
            result.setVersion("1.0.0");

            // Auth
            JsonNode auth = root.path("auth");
            if (auth.has("type")) {
                String authType = auth.path("type").asText();
                switch (authType) {
                    case "apikey" -> result.getAuthSchemes().add("API_KEY");
                    case "bearer" -> result.getAuthSchemes().add("OAUTH2");
                    case "basic" -> result.getAuthSchemes().add("BASIC");
                    case "oauth2" -> result.getAuthSchemes().add("OAUTH2");
                }
            }

            // Items (recursive)
            parsePostmanItems(root.path("item"), result, "");

            if (result.getRoutes().isEmpty()) result.getWarnings().add("No requests found in Postman collection");
        } catch (Exception e) {
            result.getWarnings().add("Parse error: " + e.getMessage());
        }
        return result;
    }

    private void parsePostmanItems(JsonNode items, ImportApiResult result, String prefix) {
        if (!items.isArray()) return;
        for (JsonNode item : items) {
            if (item.has("item")) {
                // Folder — recurse
                String folderName = item.path("name").asText("");
                parsePostmanItems(item.path("item"), result, prefix + "/" + folderName);
            } else if (item.has("request")) {
                JsonNode request = item.path("request");
                String method = request.path("method").asText("GET");
                String url;
                if (request.path("url").isTextual()) {
                    url = request.path("url").asText();
                } else {
                    url = request.path("url").path("raw").asText("");
                }
                // Extract path from URL
                String path = url.replaceAll("https?://[^/]+", "").replaceAll("\\?.*", "");
                if (path.isEmpty()) path = "/";
                // Replace Postman variables {{var}} with {var}
                path = path.replaceAll("\\{\\{([^}]+)}}", "{$1}");

                result.getRoutes().add(ImportedRoute.builder()
                        .path(path).method(method)
                        .description(item.path("name").asText(""))
                        .build());
            }
        }
    }

    // ── OpenRPC (JSON-RPC) ──────────────────────────────────────────

    private ImportApiResult parseOpenRpc(String content) {
        var result = ImportApiResult.builder()
                .detectedFormat("OPENRPC").protocolType("JSON_RPC").rawSpec(content).build();
        try {
            JsonNode root = objectMapper.readTree(content);
            JsonNode info = root.path("info");

            result.setName(info.path("title").asText("JSON-RPC API"));
            result.setVersion(info.path("version").asText("1.0.0"));
            result.setDescription(info.path("description").asText(""));

            // Single POST /rpc endpoint
            result.getRoutes().add(ImportedRoute.builder()
                    .path("/rpc").method("POST").description("JSON-RPC endpoint").build());

            // Methods
            JsonNode methods = root.path("methods");
            if (methods.isArray()) {
                List<String> methodNames = new ArrayList<>();
                for (JsonNode method : methods) {
                    methodNames.add(method.path("name").asText());
                }
                result.setDescription("JSON-RPC API with " + methodNames.size() + " methods: " + String.join(", ", methodNames));
            }

            result.setTags(List.of("json-rpc"));
        } catch (Exception e) {
            result.getWarnings().add("Parse error: " + e.getMessage());
        }
        return result;
    }

    // ── OData ($metadata / EDMX) ────────────────────────────────────

    private ImportApiResult parseOData(String content) {
        var result = ImportApiResult.builder()
                .detectedFormat("ODATA_EDMX").protocolType("ODATA").rawSpec(content).build();

        result.setName("OData Service");
        result.setVersion("1.0.0");
        result.setTags(List.of("odata"));

        // Try JSON format ($metadata in JSON)
        if (content.trim().startsWith("{")) {
            try {
                JsonNode root = objectMapper.readTree(content);
                // Extract entity sets
                root.fields().forEachRemaining(entry -> {
                    if (entry.getKey().contains("Container") || entry.getKey().startsWith("Default")) {
                        entry.getValue().fields().forEachRemaining(entityField -> {
                            String entitySet = entityField.getKey();
                            if (!entitySet.startsWith("$")) {
                                addODataRoutes(result, entitySet);
                            }
                        });
                    }
                });
            } catch (Exception e) {
                result.getWarnings().add("Parse error: " + e.getMessage());
            }
        } else {
            // XML format — extract EntitySet names
            for (String line : content.split("\n")) {
                String trimmed = line.trim();
                if (trimmed.contains("EntitySet") && trimmed.contains("Name=")) {
                    String name = extractXmlAttr(trimmed, "EntitySet", "Name");
                    if (name != null) addODataRoutes(result, name);
                }
            }
        }

        result.setDescription("OData service with " + (result.getRoutes().size() / 4) + " entity sets");
        if (result.getRoutes().isEmpty()) result.getWarnings().add("No entity sets found in OData metadata");

        return result;
    }

    private void addODataRoutes(ImportApiResult result, String entitySet) {
        String path = "/odata/" + entitySet;
        result.getRoutes().add(ImportedRoute.builder().path(path).method("GET").description("List " + entitySet).build());
        result.getRoutes().add(ImportedRoute.builder().path(path + "({id})").method("GET").description("Get " + entitySet + " by ID").build());
        result.getRoutes().add(ImportedRoute.builder().path(path).method("POST").description("Create " + entitySet).build());
        result.getRoutes().add(ImportedRoute.builder().path(path + "({id})").method("DELETE").description("Delete " + entitySet).build());
    }

    // ── HAR (HTTP Archive) ──────────────────────────────────────────

    private ImportApiResult parseHar(String content) {
        var result = ImportApiResult.builder()
                .detectedFormat("HAR").protocolType("REST").rawSpec(content).build();

        result.setName("Discovered API");
        result.setVersion("1.0.0");
        result.setTags(List.of("discovered", "har"));

        try {
            JsonNode root = objectMapper.readTree(content);
            JsonNode entries = root.path("log").path("entries");

            Set<String> seen = new HashSet<>();

            if (entries.isArray()) {
                for (JsonNode entry : entries) {
                    JsonNode request = entry.path("request");
                    String method = request.path("method").asText("GET");
                    String url = request.path("url").asText("");

                    // Extract path
                    String path = url.replaceAll("https?://[^/]+", "").replaceAll("\\?.*", "");
                    if (path.isEmpty()) continue;

                    // Deduplicate
                    String key = method + " " + path;
                    if (seen.contains(key)) continue;
                    seen.add(key);

                    // Extract server from first entry
                    if (result.getServers().isEmpty()) {
                        String server = url.replaceAll("(/[^/].*)", "");
                        if (!server.isEmpty()) result.getServers().add(server);
                    }

                    result.getRoutes().add(ImportedRoute.builder()
                            .path(path).method(method)
                            .description("Discovered from traffic")
                            .build());
                }
            }

            result.setDescription("API discovered from " + result.getRoutes().size() + " unique requests in HAR traffic");
            result.getWarnings().add("Routes discovered from recorded traffic — review carefully before publishing");
        } catch (Exception e) {
            result.getWarnings().add("Parse error: " + e.getMessage());
        }
        return result;
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private JsonNode readJsonOrYaml(String content) throws Exception {
        String trimmed = content.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            return objectMapper.readTree(trimmed);
        }
        // Simple YAML-to-JSON: try parsing as JSON first, then use a basic YAML approach
        // For production, use a proper YAML parser (SnakeYAML)
        try {
            return objectMapper.readTree(trimmed);
        } catch (Exception e) {
            // Basic YAML handling — convert common YAML patterns to JSON-like structure
            // This is a simplified parser; for full YAML support, add snakeyaml dependency
            throw new RuntimeException("YAML parsing requires restart with YAML content converted to JSON. Paste JSON format or use file upload.");
        }
    }

    private String extractXmlAttr(String xml, String element, String attr) {
        int idx = xml.indexOf(element);
        if (idx < 0) return null;
        int attrIdx = xml.indexOf(attr + "=\"", idx);
        if (attrIdx < 0) return null;
        int start = attrIdx + attr.length() + 2;
        int end = xml.indexOf("\"", start);
        if (end < 0) return null;
        return xml.substring(start, end);
    }
}

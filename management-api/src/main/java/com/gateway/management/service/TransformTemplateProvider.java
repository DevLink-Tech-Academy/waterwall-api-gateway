package com.gateway.management.service;

import lombok.AllArgsConstructor;
import lombok.Data;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * Provides pre-built transformation policy templates.
 */
@Service
public class TransformTemplateProvider {

    @Data
    @AllArgsConstructor
    public static class TransformTemplate {
        private String name;
        private String description;
        private String category;
        private Map<String, Object> config;
    }

    public List<TransformTemplate> getTemplates() {
        return List.of(
                new TransformTemplate(
                        "Strip Internal Headers",
                        "Remove internal/debug headers from API responses before they reach consumers",
                        "response",
                        Map.of("response", Map.of("headers", List.of(
                                Map.of("action", "remove", "name", "X-Internal-Request-Id"),
                                Map.of("action", "remove", "name", "X-Debug-Info"),
                                Map.of("action", "remove", "name", "Server"),
                                Map.of("action", "remove", "name", "X-Powered-By")
                        )))
                ),
                new TransformTemplate(
                        "Add API Version Header",
                        "Add version identification headers to all API responses",
                        "response",
                        Map.of("response", Map.of("headers", List.of(
                                Map.of("action", "add", "name", "X-API-Version", "value", "1.0"),
                                Map.of("action", "add", "name", "X-Gateway", "value", "true")
                        )))
                ),
                new TransformTemplate(
                        "Add CORS Headers",
                        "Add standard CORS headers to API responses",
                        "response",
                        Map.of("response", Map.of("headers", List.of(
                                Map.of("action", "add", "name", "Access-Control-Allow-Origin", "value", "*"),
                                Map.of("action", "add", "name", "Access-Control-Allow-Methods", "value", "GET, POST, PUT, DELETE, OPTIONS"),
                                Map.of("action", "add", "name", "Access-Control-Allow-Headers", "value", "Content-Type, Authorization"),
                                Map.of("action", "add", "name", "Access-Control-Max-Age", "value", "86400")
                        )))
                ),
                new TransformTemplate(
                        "Request Field Mapping",
                        "Map legacy request body field names to the new API schema format",
                        "request",
                        Map.of("request", Map.of("body", List.of(
                                Map.of("source", "user_name", "target", "username"),
                                Map.of("source", "email_address", "target", "email"),
                                Map.of("source", "phone_number", "target", "phone")
                        )))
                ),
                new TransformTemplate(
                        "Response Field Mapping",
                        "Reshape response body to match expected consumer schema",
                        "response",
                        Map.of("response", Map.of("body", List.of(
                                Map.of("source", "data", "target", "result"),
                                Map.of("source", "meta.total", "target", "totalCount"),
                                Map.of("source", "meta.page", "target", "currentPage")
                        )))
                ),
                new TransformTemplate(
                        "Add Tracking Query Params",
                        "Inject tracking query parameters into upstream requests",
                        "request",
                        Map.of("request", Map.of("queryParams", List.of(
                                Map.of("action", "add", "name", "gateway", "value", "true"),
                                Map.of("action", "add", "name", "source", "value", "api-gateway")
                        )))
                ),
                new TransformTemplate(
                        "Remove Sensitive Query Params",
                        "Strip sensitive query parameters before forwarding to upstream",
                        "request",
                        Map.of("request", Map.of("queryParams", List.of(
                                Map.of("action", "remove", "name", "api_key"),
                                Map.of("action", "remove", "name", "secret"),
                                Map.of("action", "remove", "name", "token")
                        )))
                ),
                new TransformTemplate(
                        "URL Version Rewrite",
                        "Rewrite v1 API paths to v2 upstream endpoints",
                        "request",
                        Map.of("request", Map.of("urlRewrite", Map.of(
                                "pattern", "/api/v1/(.*)",
                                "replacement", "/api/v2/$1"
                        )))
                ),
                new TransformTemplate(
                        "Add Request Gateway Headers",
                        "Inject gateway identification headers into upstream requests",
                        "request",
                        Map.of("request", Map.of("headers", List.of(
                                Map.of("action", "add", "name", "X-Gateway-Request", "value", "true"),
                                Map.of("action", "add", "name", "X-Forwarded-Via", "value", "api-gateway"),
                                Map.of("action", "remove", "name", "X-Debug")
                        )))
                ),
                new TransformTemplate(
                        "Full Request + Response Transform",
                        "Complete transformation with request headers, query params, and response body mapping",
                        "both",
                        Map.of(
                                "request", Map.of(
                                        "headers", List.of(
                                                Map.of("action", "add", "name", "X-Gateway", "value", "true")
                                        ),
                                        "queryParams", List.of(
                                                Map.of("action", "add", "name", "format", "value", "json")
                                        )
                                ),
                                "response", Map.of(
                                        "headers", List.of(
                                                Map.of("action", "remove", "name", "Server")
                                        ),
                                        "body", List.of(
                                                Map.of("source", "data", "target", "result")
                                        )
                                )
                        )
                )
        );
    }
}

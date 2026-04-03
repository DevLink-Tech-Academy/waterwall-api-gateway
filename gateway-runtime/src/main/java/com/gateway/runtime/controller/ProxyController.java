package com.gateway.runtime.controller;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.gateway.runtime.model.GatewayRoute;
import com.gateway.runtime.model.MatchedRoute;
import com.gateway.runtime.proxy.ProtocolDispatcher;
import com.gateway.runtime.proxy.SseProxyHandler;
import com.gateway.runtime.transform.BodyTransformer;
import com.gateway.runtime.transform.HeaderTransformer;
import com.gateway.runtime.transform.TransformationConfig;
import com.gateway.runtime.transform.TransformationFilter;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Catch-all proxy controller that forwards every request that has survived the
 * filter pipeline to the matched upstream service. Delegates to protocol-specific
 * handlers via {@link ProtocolDispatcher}.
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class ProxyController {

    private final ProtocolDispatcher protocolDispatcher;
    private final HeaderTransformer headerTransformer;
    private final BodyTransformer bodyTransformer;

    @RequestMapping("/**")
    public Object proxy(HttpServletRequest request, HttpServletResponse response) {

        // -- 1. Retrieve matched route from filter pipeline ---
        MatchedRoute matchedRoute = (MatchedRoute) request.getAttribute("gateway.matchedRoute");
        if (matchedRoute == null) {
            log.warn("No matched route found for {} {}", request.getMethod(), request.getRequestURI());
            return ResponseEntity.status(404)
                    .body("{\"error\":\"no_route\",\"message\":\"No route matched\"}".getBytes());
        }

        GatewayRoute route = matchedRoute.getRoute();

        // -- 2. Determine protocol type ---
        String protocolType = route.getProtocolType();
        if (protocolType == null || protocolType.isBlank()) {
            protocolType = "REST"; // default
        }

        // WebSocket is handled by WebSocketConfig -- should not reach here
        if ("WEBSOCKET".equalsIgnoreCase(protocolType)) {
            log.warn("WebSocket request reached ProxyController -- should be handled by WebSocketConfig");
            return ResponseEntity.status(426)
                    .body("{\"error\":\"upgrade_required\",\"message\":\"WebSocket upgrade required\"}".getBytes());
        }

        log.debug("Dispatching {} {} via {} protocol", request.getMethod(), request.getRequestURI(), protocolType);

        // -- 3. Delegate to protocol handler ---
        ResponseEntity<byte[]> result = protocolDispatcher.dispatch(protocolType, request, matchedRoute);

        // SSE handler returns null and sets an SseEmitter as attribute
        if (result == null) {
            SseEmitter emitter = (SseEmitter) request.getAttribute(SseProxyHandler.SSE_EMITTER_ATTR);
            if (emitter != null) {
                return emitter;
            }
            return ResponseEntity.status(500)
                    .body("{\"error\":\"internal_error\",\"message\":\"Protocol handler returned no response\"}".getBytes());
        }

        // -- 4. Apply response-side transformations ---
        result = applyResponseTransforms(request, result);

        return result;
    }

    @SuppressWarnings("unchecked")
    private ResponseEntity<byte[]> applyResponseTransforms(HttpServletRequest request,
                                                            ResponseEntity<byte[]> result) {
        List<TransformationConfig> configs = (List<TransformationConfig>)
                request.getAttribute(TransformationFilter.ATTR_TRANSFORM_CONFIGS);

        if (configs == null || configs.isEmpty()) {
            return result;
        }

        byte[] body = result.getBody();
        HttpHeaders headers = HttpHeaders.writableHttpHeaders(result.getHeaders());
        boolean modified = false;

        for (TransformationConfig config : configs) {
            TransformationConfig.ResponseTransform respTransform = config.getResponse();
            if (respTransform == null) continue;

            // Response header transforms
            if (respTransform.getHeaders() != null && !respTransform.getHeaders().isEmpty()) {
                for (TransformationConfig.HeaderRule rule : respTransform.getHeaders()) {
                    String action = rule.getAction();
                    if (action == null) continue;
                    switch (action) {
                        case "add" -> {
                            headers.add(rule.getName(), rule.getValue());
                            modified = true;
                        }
                        case "override" -> {
                            headers.set(rule.getName(), rule.getValue());
                            modified = true;
                        }
                        case "remove" -> {
                            headers.remove(rule.getName());
                            modified = true;
                        }
                        case "rename" -> {
                            List<String> values = headers.remove(rule.getName());
                            if (values != null && !values.isEmpty()) {
                                headers.addAll(rule.getNewName(), values);
                            }
                            modified = true;
                        }
                    }
                }
            }

            // Response body transforms
            if (respTransform.getBody() != null && !respTransform.getBody().isEmpty() && body != null && body.length > 0) {
                List<Map<String, String>> mappingRules = respTransform.getBody().stream()
                        .map(rule -> {
                            Map<String, String> map = new LinkedHashMap<>();
                            map.put("source", rule.getSource());
                            map.put("target", rule.getTarget());
                            return map;
                        })
                        .toList();
                body = bodyTransformer.jsonToJson(body, mappingRules);
                modified = true;
            }
        }

        if (!modified) {
            return result;
        }

        // Update content-length if body was modified
        if (body != null) {
            headers.setContentLength(body.length);
        }

        log.debug("Applied response transformations");
        return ResponseEntity.status(result.getStatusCode())
                .headers(headers)
                .body(body);
    }
}

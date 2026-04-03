package com.gateway.runtime.transform;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.runtime.filter.RouteMatchFilter;
import com.gateway.runtime.model.MatchedRoute;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Order(43) -- Request/Response transformation filter.
 * Applies request-side transforms (headers, body, query params, URL rewrite)
 * before the request reaches the proxy controller.
 * Stores transformation configs as request attribute for response-side processing.
 */
@Slf4j
@Component
@Order(43)
@RequiredArgsConstructor
public class TransformationFilter implements Filter {

    public static final String ATTR_TRANSFORM_CONFIGS = "gateway.transformConfigs";

    private final HeaderTransformer headerTransformer;
    private final BodyTransformer bodyTransformer;
    private final QueryParamTransformer queryParamTransformer;
    private final UrlRewriter urlRewriter;
    private final TransformationPolicyLoader policyLoader;
    private final ObjectMapper objectMapper;

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) servletRequest;
        HttpServletResponse response = (HttpServletResponse) servletResponse;

        MatchedRoute matchedRoute = (MatchedRoute) request.getAttribute(RouteMatchFilter.ATTR_MATCHED_ROUTE);
        if (matchedRoute == null) {
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        // Load transformation policies for this API/route
        List<TransformationConfig> configs = policyLoader.getConfigs(
                matchedRoute.getRoute().getApiId(),
                matchedRoute.getRoute().getRouteId()
        );

        if (configs.isEmpty()) {
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        log.debug("Applying {} transformation config(s) for {} {}",
                configs.size(), request.getMethod(), request.getRequestURI());

        // Store configs for response-side processing in ProxyController
        request.setAttribute(ATTR_TRANSFORM_CONFIGS, configs);

        // Apply request-side transforms
        HttpServletRequest transformedRequest = applyRequestTransforms(request, configs);

        filterChain.doFilter(transformedRequest, response);

        log.trace("TransformationFilter completed for path: {}", request.getRequestURI());
    }

    private HttpServletRequest applyRequestTransforms(HttpServletRequest request,
                                                       List<TransformationConfig> configs) throws IOException {
        Map<String, List<String>> modifiedHeaders = null;
        Map<String, String[]> modifiedParams = new LinkedHashMap<>(request.getParameterMap());
        byte[] body = null;
        String uri = request.getRequestURI();
        boolean hasChanges = false;

        for (TransformationConfig config : configs) {
            TransformationConfig.RequestTransform reqTransform = config.getRequest();
            if (reqTransform == null) continue;

            // Header transforms
            if (reqTransform.getHeaders() != null && !reqTransform.getHeaders().isEmpty()) {
                Map<String, List<String>> headerChanges = headerTransformer.applyRequestRules(
                        request, reqTransform.getHeaders());
                if (headerChanges != null) {
                    if (modifiedHeaders == null) {
                        modifiedHeaders = new LinkedHashMap<>(headerChanges);
                    } else {
                        modifiedHeaders.putAll(headerChanges);
                    }
                    hasChanges = true;
                }
            }

            // Query param transforms
            if (reqTransform.getQueryParams() != null && !reqTransform.getQueryParams().isEmpty()) {
                modifiedParams = queryParamTransformer.applyRules(modifiedParams, reqTransform.getQueryParams());
                hasChanges = true;
            }

            // URL rewrite
            if (reqTransform.getUrlRewrite() != null) {
                String rewritten = urlRewriter.rewrite(uri, reqTransform.getUrlRewrite());
                if (!rewritten.equals(uri)) {
                    uri = rewritten;
                    hasChanges = true;
                }
            }

            // Body transforms
            if (reqTransform.getBody() != null && !reqTransform.getBody().isEmpty()) {
                if (body == null) {
                    body = request.getInputStream().readAllBytes();
                }
                if (body.length > 0) {
                    // Convert typed rules to Map format for BodyTransformer
                    List<Map<String, String>> mappingRules = reqTransform.getBody().stream()
                            .map(rule -> {
                                Map<String, String> map = new LinkedHashMap<>();
                                map.put("source", rule.getSource());
                                map.put("target", rule.getTarget());
                                return map;
                            })
                            .toList();
                    body = bodyTransformer.jsonToJson(body, mappingRules);
                    hasChanges = true;
                }
            }
        }

        if (!hasChanges) {
            return request;
        }

        // If body was not transformed but we need to wrap for other changes,
        // read the body so it can be replayed
        if (body == null) {
            body = request.getInputStream().readAllBytes();
        }

        return new TransformableRequestWrapper(
                request,
                body,
                modifiedHeaders,
                modifiedParams,
                uri.equals(request.getRequestURI()) ? null : uri
        );
    }
}

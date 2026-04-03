package com.gateway.runtime.transform;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Applies header-level transformations (add, remove, rename) to requests and responses.
 */
@Slf4j
@Component
public class HeaderTransformer {

    // ── Response-side transformations ───────────────────────────────────

    public void addHeader(HttpServletResponse response, String name, String value) {
        response.addHeader(name, value);
        log.debug("Added response header: {}={}", name, value);
    }

    public void removeHeader(HttpServletResponse response, String name) {
        response.setHeader(name, null);
        log.debug("Removed response header: {}", name);
    }

    public void renameHeader(HttpServletResponse response, String oldName, String newName) {
        String value = response.getHeader(oldName);
        if (value != null) {
            response.setHeader(newName, value);
            response.setHeader(oldName, null);
            log.debug("Renamed response header: {} -> {}", oldName, newName);
        }
    }

    @SuppressWarnings("unchecked")
    public void applyRules(HttpServletResponse response, List<Map<String, String>> rules) {
        if (rules == null) return;
        for (Map<String, String> rule : rules) {
            String action = rule.getOrDefault("action", "");
            switch (action) {
                case "add" -> addHeader(response, rule.get("name"), rule.get("value"));
                case "remove" -> removeHeader(response, rule.get("name"));
                case "rename" -> renameHeader(response, rule.get("name"), rule.get("newName"));
                default -> log.warn("Unknown header transformation action: {}", action);
            }
        }
    }

    // ── Request-side transformations ────────────────────────────────────

    /**
     * Build a modified header map from the original request headers and transformation rules.
     * Returns a map keyed by lowercase header name to list of values.
     * An empty list means the header should be removed.
     */
    public Map<String, List<String>> applyRequestRules(HttpServletRequest request,
                                                        List<TransformationConfig.HeaderRule> rules) {
        if (rules == null || rules.isEmpty()) {
            return null;
        }

        Map<String, List<String>> headerMap = new LinkedHashMap<>();

        for (TransformationConfig.HeaderRule rule : rules) {
            String action = rule.getAction();
            if (action == null) continue;

            String name = rule.getName() != null ? rule.getName().toLowerCase() : null;

            switch (action) {
                case "add", "override" -> {
                    if (name != null && rule.getValue() != null) {
                        if ("override".equals(action)) {
                            headerMap.put(name, new ArrayList<>(List.of(rule.getValue())));
                        } else {
                            headerMap.computeIfAbsent(name, k -> {
                                // Start with existing values from request
                                List<String> existing = new ArrayList<>();
                                Enumeration<String> vals = request.getHeaders(rule.getName());
                                while (vals.hasMoreElements()) {
                                    existing.add(vals.nextElement());
                                }
                                return existing;
                            }).add(rule.getValue());
                        }
                        log.debug("Request header {}: {}={}", action, name, rule.getValue());
                    }
                }
                case "remove" -> {
                    if (name != null) {
                        headerMap.put(name, Collections.emptyList());
                        log.debug("Request header remove: {}", name);
                    }
                }
                case "rename" -> {
                    if (name != null && rule.getNewName() != null) {
                        // Get original value
                        String origValue = request.getHeader(rule.getName());
                        if (origValue != null) {
                            headerMap.put(name, Collections.emptyList()); // remove old
                            headerMap.put(rule.getNewName().toLowerCase(), new ArrayList<>(List.of(origValue)));
                            log.debug("Request header rename: {} -> {}", name, rule.getNewName());
                        }
                    }
                }
                default -> log.warn("Unknown request header action: {}", action);
            }
        }

        return headerMap;
    }

    /**
     * Apply typed response header rules (from TransformationConfig).
     */
    public void applyResponseRules(HttpServletResponse response,
                                    List<TransformationConfig.HeaderRule> rules) {
        if (rules == null) return;
        for (TransformationConfig.HeaderRule rule : rules) {
            String action = rule.getAction();
            if (action == null) continue;
            switch (action) {
                case "add", "override" -> {
                    if ("override".equals(action)) {
                        response.setHeader(rule.getName(), rule.getValue());
                    } else {
                        addHeader(response, rule.getName(), rule.getValue());
                    }
                }
                case "remove" -> removeHeader(response, rule.getName());
                case "rename" -> renameHeader(response, rule.getName(), rule.getNewName());
                default -> log.warn("Unknown response header action: {}", action);
            }
        }
    }
}

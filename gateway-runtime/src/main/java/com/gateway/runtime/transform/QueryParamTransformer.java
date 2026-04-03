package com.gateway.runtime.transform;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Applies query parameter transformations (add, remove, rename).
 */
@Slf4j
@Component
public class QueryParamTransformer {

    public Map<String, String[]> applyRules(Map<String, String[]> originalParams,
                                             List<TransformationConfig.QueryParamRule> rules) {
        if (rules == null || rules.isEmpty()) {
            return originalParams;
        }

        Map<String, String[]> result = new LinkedHashMap<>(originalParams);

        for (TransformationConfig.QueryParamRule rule : rules) {
            String action = rule.getAction();
            if (action == null) continue;

            switch (action) {
                case "add", "override" -> {
                    if (rule.getName() != null) {
                        result.put(rule.getName(), new String[]{rule.getValue() != null ? rule.getValue() : ""});
                        log.debug("Added/overrode query param: {}={}", rule.getName(), rule.getValue());
                    }
                }
                case "remove" -> {
                    if (rule.getName() != null) {
                        result.remove(rule.getName());
                        log.debug("Removed query param: {}", rule.getName());
                    }
                }
                case "rename" -> {
                    if (rule.getName() != null && rule.getNewName() != null) {
                        String[] values = result.remove(rule.getName());
                        if (values != null) {
                            result.put(rule.getNewName(), values);
                            log.debug("Renamed query param: {} -> {}", rule.getName(), rule.getNewName());
                        }
                    }
                }
                default -> log.warn("Unknown query param action: {}", action);
            }
        }

        return result;
    }
}

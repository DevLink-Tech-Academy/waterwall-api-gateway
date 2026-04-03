package com.gateway.runtime.transform;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Applies URL path rewriting using regex patterns.
 */
@Slf4j
@Component
public class UrlRewriter {

    public String rewrite(String originalPath, TransformationConfig.UrlRewriteRule rule) {
        if (rule == null || rule.getPattern() == null || rule.getReplacement() == null) {
            return originalPath;
        }

        try {
            Pattern pattern = Pattern.compile(rule.getPattern());
            Matcher matcher = pattern.matcher(originalPath);
            if (matcher.find()) {
                String rewritten = matcher.replaceAll(rule.getReplacement());
                log.debug("URL rewritten: {} -> {}", originalPath, rewritten);
                return rewritten;
            }
        } catch (Exception e) {
            log.error("URL rewrite failed for pattern '{}': {}", rule.getPattern(), e.getMessage());
        }

        return originalPath;
    }
}

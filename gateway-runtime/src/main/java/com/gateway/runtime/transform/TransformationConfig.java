package com.gateway.runtime.transform;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import java.util.List;

/**
 * POJO representing the full transformation configuration stored in a TRANSFORM policy's config JSONB.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class TransformationConfig {

    private RequestTransform request;
    private ResponseTransform response;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RequestTransform {
        private List<HeaderRule> headers;
        private List<BodyMappingRule> body;
        private List<QueryParamRule> queryParams;
        private UrlRewriteRule urlRewrite;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ResponseTransform {
        private List<HeaderRule> headers;
        private List<BodyMappingRule> body;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class HeaderRule {
        private String action; // add, remove, rename, override
        private String name;
        private String value;
        private String newName; // for rename
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BodyMappingRule {
        private String source; // JSON path (dot-notation)
        private String target; // target field name
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class QueryParamRule {
        private String action; // add, remove, rename
        private String name;
        private String value;
        private String newName;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UrlRewriteRule {
        private String pattern;      // regex pattern to match
        private String replacement;  // replacement string with group refs
    }
}

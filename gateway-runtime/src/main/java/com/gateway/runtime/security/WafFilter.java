package com.gateway.runtime.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequestWrapper;

/**
 * Order(8) — Web Application Firewall filter that inspects incoming requests
 * for common attack patterns including SQL injection, XSS, path traversal,
 * command injection, and CRLF injection. Matched requests are blocked with
 * a 403 response.
 */
@Slf4j
@Component
@Order(8)
public class WafFilter implements Filter {

    private final ObjectMapper objectMapper;

    @Value("${gateway.waf.enabled:true}")
    private boolean enabled;

    @Value("${gateway.waf.log-only:false}")
    private boolean logOnly;

    private static final int MAX_BODY_SIZE = 64 * 1024; // 64KB

    private static final Set<String> SKIPPED_HEADERS = Set.of("authorization", "cookie");

    private static final Set<String> INSPECTABLE_CONTENT_TYPES = Set.of(
            "application/json", "application/xml", "text/xml",
            "text/plain", "text/html", "application/x-www-form-urlencoded"
    );

    private Map<String, Pattern> wafRules;

    public WafFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    public void init() {
        wafRules = new LinkedHashMap<>();

        // SQL Injection patterns
        wafRules.put("SQL_INJECTION", Pattern.compile(
                "(?i)"
                + "("
                + "\\bunion\\s+(all\\s+)?select\\b"
                + "|\\bselect\\b.+\\bfrom\\b.+\\bwhere\\b"
                + "|\\bdrop\\s+(table|database|index)\\b"
                + "|\\binsert\\s+into\\b"
                + "|\\bdelete\\s+from\\b"
                + "|\\bupdate\\s+\\w+\\s+set\\b"
                + "|\\balter\\s+table\\b"
                + "|\\bexec(ute)?\\s*\\("
                + "|\\bor\\s+1\\s*=\\s*1"
                + "|\\band\\s+1\\s*=\\s*1"
                + "|\\bor\\s+'[^']*'\\s*=\\s*'[^']*'"
                + "|'\\s*(or|and)\\s+.*--"
                + "|;\\s*(drop|alter|delete|insert|update|exec)\\b"
                + "|\\b(waitfor\\s+delay|benchmark\\s*\\(|sleep\\s*\\()"
                + "|--\\s*$"
                + "|/\\*.*\\*/"
                + ")"
        ));

        // XSS patterns
        wafRules.put("XSS", Pattern.compile(
                "(?i)"
                + "("
                + "<\\s*script[^>]*>"
                + "|<\\s*/\\s*script\\s*>"
                + "|javascript\\s*:"
                + "|vbscript\\s*:"
                + "|\\bon(load|error|click|mouseover|mouseout|submit|focus|blur|change"
                    + "|keydown|keyup|keypress|mousedown|mouseup|dblclick|contextmenu"
                    + "|abort|beforeunload|unload|resize|scroll)\\s*="
                + "|<\\s*img[^>]+\\bon\\w+\\s*="
                + "|<\\s*iframe[^>]*>"
                + "|<\\s*object[^>]*>"
                + "|<\\s*embed[^>]*>"
                + "|<\\s*svg[^>]*\\bon\\w+\\s*="
                + "|\\bexpression\\s*\\("
                + "|\\balert\\s*\\("
                + "|\\beval\\s*\\("
                + "|\\bdocument\\s*\\.(cookie|location|write)"
                + "|\\bwindow\\s*\\.location"
                + ")"
        ));

        // Path Traversal patterns
        wafRules.put("PATH_TRAVERSAL", Pattern.compile(
                "("
                + "\\.\\./|\\.\\.\\\\/"
                + "|%2e%2e[/%5c]"
                + "|%2e%2e%2f"
                + "|%2e%2e%5c"
                + "|\\.%2e[/%5c]"
                + "|%2e\\.[/%5c]"
                + "|\\.\\.%255c"
                + "|\\.\\.%c0%af"
                + "|\\.\\.%c1%9c"
                + "|/etc/passwd"
                + "|/etc/shadow"
                + "|\\bboot\\.ini\\b"
                + "|\\bwin\\.ini\\b"
                + ")",
                Pattern.CASE_INSENSITIVE
        ));

        // Command Injection patterns
        wafRules.put("COMMAND_INJECTION", Pattern.compile(
                "("
                + "[;&|`]\\s*(cat|ls|dir|whoami|id|uname|pwd|wget|curl|nc|ncat|bash|sh|cmd|powershell)\\b"
                + "|\\$\\((cat|ls|whoami|id|uname|pwd)\\)"
                + "|`(cat|ls|whoami|id|uname|pwd)`"
                + "|\\|\\s*(cat|ls|dir|whoami|id|uname|pwd|wget|curl|nc|bash|sh|cmd)\\b"
                + "|\\b(system|exec|passthru|shell_exec|popen|proc_open)\\s*\\("
                + "|\\$\\{IFS\\}"
                + ")",
                Pattern.CASE_INSENSITIVE
        ));

        // CRLF Injection patterns
        wafRules.put("CRLF_INJECTION", Pattern.compile(
                "("
                + "%0d%0a"
                + "|%0d"
                + "|%0a"
                + "|\\\\r\\\\n"
                + "|\\r\\n"
                + ")",
                Pattern.CASE_INSENSITIVE
        ));

        log.info("WAF filter initialized: enabled={}, logOnly={}, rules={}", enabled, logOnly, wafRules.size());
    }

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse,
                         FilterChain filterChain) throws IOException, ServletException {

        if (!enabled) {
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        if (!(servletRequest instanceof HttpServletRequest request)
                || !(servletResponse instanceof HttpServletResponse response)) {
            filterChain.doFilter(servletRequest, servletResponse);
            return;
        }

        // Skip actuator endpoints
        String path = request.getRequestURI();
        if (path.startsWith("/actuator")) {
            filterChain.doFilter(request, response);
            return;
        }

        // Skip WAF for API-key authenticated requests — they're legitimate programmatic clients
        // WAF regex scanning adds latency; authenticated clients don't need it
        String apiKey = request.getHeader("X-API-Key");
        if (apiKey != null && !apiKey.isBlank()) {
            filterChain.doFilter(request, response);
            return;
        }

        String clientIp = extractClientIp(request);

        // Check URL (decoded URI)
        String matchedRule = inspectValue(path);
        if (matchedRule != null) {
            handleViolation(response, request, clientIp, matchedRule, "URL");
            if (!logOnly) return;
        }

        // Check query string (raw)
        String queryString = request.getQueryString();
        if (queryString != null) {
            matchedRule = inspectValue(queryString);
            if (matchedRule != null) {
                handleViolation(response, request, clientIp, matchedRule, "QUERY_STRING");
                if (!logOnly) return;
            }
        }

        // Check headers (skip Authorization and Cookie)
        Enumeration<String> headerNames = request.getHeaderNames();
        if (headerNames != null) {
            while (headerNames.hasMoreElements()) {
                String headerName = headerNames.nextElement();
                if (SKIPPED_HEADERS.contains(headerName.toLowerCase())) {
                    continue;
                }
                String headerValue = request.getHeader(headerName);
                if (headerValue != null) {
                    // For headers, only check CRLF injection
                    String crlfMatch = matchAgainstRule("CRLF_INJECTION", headerValue);
                    if (crlfMatch != null) {
                        handleViolation(response, request, clientIp, crlfMatch, "HEADER:" + headerName);
                        if (!logOnly) return;
                    }
                    // Also check other patterns in header values
                    matchedRule = inspectValue(headerValue);
                    if (matchedRule != null) {
                        handleViolation(response, request, clientIp, matchedRule, "HEADER:" + headerName);
                        if (!logOnly) return;
                    }
                }
            }
        }

        // Check body for text-based content types
        String contentType = request.getContentType();
        if (contentType != null && shouldInspectBody(contentType)) {
            CachedBodyHttpServletRequest wrappedRequest = new CachedBodyHttpServletRequest(request);
            String body = wrappedRequest.getCachedBody();
            if (body != null && !body.isEmpty()) {
                matchedRule = inspectValue(body);
                if (matchedRule != null) {
                    handleViolation(response, wrappedRequest, clientIp, matchedRule, "BODY");
                    if (!logOnly) return;
                }
            }
            filterChain.doFilter(wrappedRequest, response);
            return;
        }

        filterChain.doFilter(request, response);
    }

    private String inspectValue(String value) {
        if (value == null || value.isEmpty()) {
            return null;
        }
        for (Map.Entry<String, Pattern> entry : wafRules.entrySet()) {
            if (entry.getValue().matcher(value).find()) {
                return entry.getKey();
            }
        }
        return null;
    }

    private String matchAgainstRule(String ruleName, String value) {
        if (value == null || value.isEmpty()) {
            return null;
        }
        Pattern pattern = wafRules.get(ruleName);
        if (pattern != null && pattern.matcher(value).find()) {
            return ruleName;
        }
        return null;
    }

    private boolean shouldInspectBody(String contentType) {
        if (contentType == null) {
            return false;
        }
        String lowerContentType = contentType.toLowerCase();
        for (String inspectable : INSPECTABLE_CONTENT_TYPES) {
            if (lowerContentType.contains(inspectable)) {
                return true;
            }
        }
        return false;
    }

    private void handleViolation(HttpServletResponse response, HttpServletRequest request,
                                 String clientIp, String rule, String location)
            throws IOException {

        log.warn("WAF violation detected: rule={}, location={}, clientIp={}, uri={}, method={}",
                rule, location, clientIp, request.getRequestURI(), request.getMethod());

        if (!logOnly) {
            writeBlockedResponse(response, rule);
        }
    }

    private void writeBlockedResponse(HttpServletResponse response, String rule) throws IOException {
        Map<String, Object> errorBody = new LinkedHashMap<>();
        errorBody.put("status", 403);
        errorBody.put("error", "WAF_BLOCKED");
        errorBody.put("message", "Request blocked by security policy");
        errorBody.put("rule", rule);

        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), errorBody);
    }

    private String extractClientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            return xff.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    /**
     * Wraps an HttpServletRequest to cache the body so it can be read
     * for inspection and then re-read by downstream filters/servlets.
     */
    private static class CachedBodyHttpServletRequest extends HttpServletRequestWrapper {

        private final byte[] cachedBody;

        CachedBodyHttpServletRequest(HttpServletRequest request) throws IOException {
            super(request);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ServletInputStream inputStream = request.getInputStream();
            byte[] buffer = new byte[4096];
            int bytesRead;
            int totalRead = 0;
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                totalRead += bytesRead;
                if (totalRead > MAX_BODY_SIZE) {
                    // Write only up to the limit
                    int remaining = MAX_BODY_SIZE - (totalRead - bytesRead);
                    if (remaining > 0) {
                        baos.write(buffer, 0, remaining);
                    }
                    break;
                }
                baos.write(buffer, 0, bytesRead);
            }
            this.cachedBody = baos.toByteArray();
        }

        String getCachedBody() {
            return new String(cachedBody, StandardCharsets.UTF_8);
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream bais = new ByteArrayInputStream(cachedBody);
            return new ServletInputStream() {
                @Override
                public boolean isFinished() {
                    return bais.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(ReadListener readListener) {
                    // Not needed for synchronous processing
                }

                @Override
                public int read() {
                    return bais.read();
                }

                @Override
                public int read(byte[] b, int off, int len) {
                    return bais.read(b, off, len);
                }
            };
        }

        @Override
        public BufferedReader getReader() {
            return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
        }
    }
}

package com.gateway.runtime.transform;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;

import java.io.*;
import java.util.*;

/**
 * HttpServletRequest wrapper that supports modified headers, query params,
 * request body, and request URI for transformation purposes.
 */
public class TransformableRequestWrapper extends HttpServletRequestWrapper {

    private final Map<String, List<String>> customHeaders;
    private final Map<String, String[]> customParams;
    private final byte[] body;
    private final String customUri;
    private final String customQueryString;

    public TransformableRequestWrapper(HttpServletRequest request, byte[] body,
                                        Map<String, List<String>> headers,
                                        Map<String, String[]> params,
                                        String uri) {
        super(request);
        this.body = body;
        this.customHeaders = headers;
        this.customParams = params;
        this.customUri = uri;
        this.customQueryString = buildQueryString(params);
    }

    @Override
    public ServletInputStream getInputStream() {
        if (body == null) {
            return new EmptyServletInputStream();
        }
        ByteArrayInputStream bais = new ByteArrayInputStream(body);
        return new ServletInputStream() {
            @Override
            public boolean isFinished() { return bais.available() == 0; }
            @Override
            public boolean isReady() { return true; }
            @Override
            public void setReadListener(ReadListener listener) { /* no-op */ }
            @Override
            public int read() { return bais.read(); }
            @Override
            public int read(byte[] b, int off, int len) { return bais.read(b, off, len); }
        };
    }

    @Override
    public BufferedReader getReader() {
        return new BufferedReader(new InputStreamReader(getInputStream()));
    }

    @Override
    public int getContentLength() {
        return body != null ? body.length : 0;
    }

    @Override
    public long getContentLengthLong() {
        return body != null ? body.length : 0;
    }

    // ── Header overrides ────────────────────────────────────────────────

    @Override
    public String getHeader(String name) {
        if (customHeaders != null) {
            List<String> values = customHeaders.get(name.toLowerCase());
            if (values != null && !values.isEmpty()) {
                return values.get(0);
            }
            // Check if header was explicitly removed (empty list means removed)
            if (customHeaders.containsKey(name.toLowerCase())) {
                return null;
            }
        }
        return super.getHeader(name);
    }

    @Override
    public Enumeration<String> getHeaders(String name) {
        if (customHeaders != null) {
            List<String> values = customHeaders.get(name.toLowerCase());
            if (values != null) {
                return Collections.enumeration(values);
            }
            if (customHeaders.containsKey(name.toLowerCase())) {
                return Collections.emptyEnumeration();
            }
        }
        return super.getHeaders(name);
    }

    @Override
    public Enumeration<String> getHeaderNames() {
        if (customHeaders != null) {
            Set<String> names = new LinkedHashSet<>();
            // Add original headers
            Enumeration<String> original = super.getHeaderNames();
            while (original.hasMoreElements()) {
                names.add(original.nextElement().toLowerCase());
            }
            // Apply custom headers (add new, keep removed as-is since get returns null)
            for (Map.Entry<String, List<String>> entry : customHeaders.entrySet()) {
                if (entry.getValue().isEmpty()) {
                    names.remove(entry.getKey());
                } else {
                    names.add(entry.getKey());
                }
            }
            return Collections.enumeration(names);
        }
        return super.getHeaderNames();
    }

    // ── Query parameter overrides ───────────────────────────────────────

    @Override
    public String getParameter(String name) {
        if (customParams != null) {
            String[] values = customParams.get(name);
            return values != null && values.length > 0 ? values[0] : null;
        }
        return super.getParameter(name);
    }

    @Override
    public Map<String, String[]> getParameterMap() {
        return customParams != null ? Collections.unmodifiableMap(customParams) : super.getParameterMap();
    }

    @Override
    public Enumeration<String> getParameterNames() {
        if (customParams != null) {
            return Collections.enumeration(customParams.keySet());
        }
        return super.getParameterNames();
    }

    @Override
    public String[] getParameterValues(String name) {
        if (customParams != null) {
            return customParams.get(name);
        }
        return super.getParameterValues(name);
    }

    @Override
    public String getQueryString() {
        return customQueryString != null ? customQueryString : super.getQueryString();
    }

    // ── URI override ────────────────────────────────────────────────────

    @Override
    public String getRequestURI() {
        return customUri != null ? customUri : super.getRequestURI();
    }

    @Override
    public StringBuffer getRequestURL() {
        if (customUri != null) {
            StringBuffer url = new StringBuffer();
            url.append(getScheme()).append("://").append(getServerName());
            int port = getServerPort();
            if (port > 0 && port != 80 && port != 443) {
                url.append(':').append(port);
            }
            url.append(customUri);
            return url;
        }
        return super.getRequestURL();
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private static String buildQueryString(Map<String, String[]> params) {
        if (params == null || params.isEmpty()) {
            return null;
        }
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String[]> entry : params.entrySet()) {
            for (String val : entry.getValue()) {
                if (sb.length() > 0) sb.append('&');
                sb.append(entry.getKey()).append('=').append(val);
            }
        }
        return sb.toString();
    }

    private static class EmptyServletInputStream extends ServletInputStream {
        @Override
        public boolean isFinished() { return true; }
        @Override
        public boolean isReady() { return true; }
        @Override
        public void setReadListener(ReadListener listener) { /* no-op */ }
        @Override
        public int read() { return -1; }
    }
}

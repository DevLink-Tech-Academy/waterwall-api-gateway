package com.gateway.runtime.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gateway.common.dto.ApiErrorResponse;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Order(4) — Detects and classifies bots based on User-Agent,
 * request rate, and known bot signatures. Blocks bad bots and
 * challenges unknown ones.
 */
@Slf4j
@Component
@Order(4)
public class BotDetectionFilter implements Filter {

    private final ObjectMapper objectMapper;

    /** Per-IP request tracking: IP -> (windowStart, count) */
    private final ConcurrentHashMap<String, RequestPattern> ipPatterns = new ConcurrentHashMap<>();

    /** Stats counters */
    private final AtomicLong goodBotCount = new AtomicLong();
    private final AtomicLong badBotCount = new AtomicLong();
    private final AtomicLong unknownBotCount = new AtomicLong();
    private final AtomicLong humanCount = new AtomicLong();

    private static final int RATE_WINDOW_SECONDS = 60;
    private static final int MAX_REQUESTS_PER_WINDOW = 200;

    private static final List<String> GOOD_BOT_SIGNATURES = List.of(
            "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
            "yandexbot", "facebot", "applebot", "linkedinbot"
    );

    private static final List<String> BAD_BOT_SIGNATURES = List.of(
            "scrapy", "httpclient", "ahrefsbot", "semrushbot", "dotbot",
            "mj12bot", "blexbot", "masscan", "nikto", "sqlmap",
            "nmap", "zgrab", "nuclei", "dirbuster"
    );

    public BotDetectionFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) servletRequest;
        HttpServletResponse response = (HttpServletResponse) servletResponse;

        // Skip bot detection for requests with valid API key — these are legitimate programmatic clients
        String apiKey = request.getHeader("X-API-Key");
        if (apiKey != null && !apiKey.isBlank()) {
            chain.doFilter(servletRequest, servletResponse);
            return;
        }

        String userAgent = request.getHeader("User-Agent");
        String ip = extractClientIp(request);

        BotClassification classification = classify(userAgent, ip);

        switch (classification) {
            case BAD_BOT -> {
                badBotCount.incrementAndGet();
                log.info("Blocked bad bot: ip={}, ua={}", ip, userAgent);
                writeBlockedResponse(response, request, "Bad bot detected and blocked");
                return;
            }
            case UNKNOWN -> {
                unknownBotCount.incrementAndGet();
                // Check rate pattern — if excessive, block
                if (isRateLimitExceeded(ip)) {
                    log.info("Blocked unknown bot (rate exceeded): ip={}, ua={}", ip, userAgent);
                    writeBlockedResponse(response, request, "Suspicious request pattern detected. Access denied.");
                    return;
                }
            }
            case GOOD_BOT -> goodBotCount.incrementAndGet();
            case HUMAN -> humanCount.incrementAndGet();
        }

        trackRequest(ip);
        chain.doFilter(servletRequest, servletResponse);
    }

    BotClassification classify(String userAgent, String ip) {
        if (userAgent == null || userAgent.isBlank()) {
            return BotClassification.UNKNOWN;
        }

        String ua = userAgent.toLowerCase();

        for (String sig : BAD_BOT_SIGNATURES) {
            if (ua.contains(sig)) {
                return BotClassification.BAD_BOT;
            }
        }

        for (String sig : GOOD_BOT_SIGNATURES) {
            if (ua.contains(sig)) {
                return BotClassification.GOOD_BOT;
            }
        }

        // Heuristic: missing typical browser tokens
        if (!ua.contains("mozilla") && !ua.contains("chrome") && !ua.contains("safari")
                && !ua.contains("firefox") && !ua.contains("edge")) {
            return BotClassification.UNKNOWN;
        }

        return BotClassification.HUMAN;
    }

    private void trackRequest(String ip) {
        long now = System.currentTimeMillis() / 1000;
        ipPatterns.compute(ip, (key, existing) -> {
            if (existing == null || (now - existing.windowStart) > RATE_WINDOW_SECONDS) {
                return new RequestPattern(now, new AtomicInteger(1));
            }
            existing.count.incrementAndGet();
            return existing;
        });
    }

    private boolean isRateLimitExceeded(String ip) {
        RequestPattern pattern = ipPatterns.get(ip);
        if (pattern == null) {
            return false;
        }
        long now = System.currentTimeMillis() / 1000;
        if ((now - pattern.windowStart) > RATE_WINDOW_SECONDS) {
            return false;
        }
        return pattern.count.get() > MAX_REQUESTS_PER_WINDOW;
    }

    private void writeBlockedResponse(HttpServletResponse response, HttpServletRequest request,
                                       String message) throws IOException {
        ApiErrorResponse error = ApiErrorResponse.builder()
                .status(403)
                .error("BOT_BLOCKED")
                .errorCode("GW_403_BOT")
                .message(message)
                .path(request.getRequestURI())
                .build();
        response.setStatus(403);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), error);
    }

    private String extractClientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            return xff.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    public Map<String, Object> getStats() {
        return Map.of(
                "goodBots", goodBotCount.get(),
                "badBots", badBotCount.get(),
                "unknownBots", unknownBotCount.get(),
                "humans", humanCount.get(),
                "trackedIps", ipPatterns.size()
        );
    }

    public enum BotClassification {
        GOOD_BOT, BAD_BOT, UNKNOWN, HUMAN
    }

    private static class RequestPattern {
        final long windowStart;
        final AtomicInteger count;

        RequestPattern(long windowStart, AtomicInteger count) {
            this.windowStart = windowStart;
            this.count = count;
        }
    }
}

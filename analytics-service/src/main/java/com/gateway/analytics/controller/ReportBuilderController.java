package com.gateway.analytics.controller;

import com.gateway.analytics.dto.ReportQueryRequest;
import com.gateway.analytics.store.RequestLogStore;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@RestController
@RequestMapping("/v1/analytics/report")
@RequiredArgsConstructor
public class ReportBuilderController {

    private final RequestLogStore store;

    private static final Set<String> ALLOWED_METRICS = Set.of(
            "request_count", "avg_latency", "error_rate", "p99_latency"
    );

    private static final Set<String> ALLOWED_GROUP_BY = Set.of(
            "api_id", "consumer_id", "day", "hour", "week", "month", "status_code", "method", "path", "auth_type"
    );

    @PostMapping("/query")
    public ResponseEntity<List<Map<String, Object>>> queryReport(
            @RequestBody ReportQueryRequest request) {
        log.info("Custom report query: metrics={}, groupBy={}", request.getMetrics(), request.getGroupBy());
        validateRequest(request);
        QueryComponents qc = buildQueryComponents(request);
        List<Map<String, Object>> results = store.executeReportQuery(
                qc.selectClauses, qc.groupByClauses, qc.whereClause, qc.params, 1000);
        return ResponseEntity.ok(results);
    }

    @GetMapping("/export")
    public ResponseEntity<String> exportReport(
            @RequestParam(required = false) List<String> metrics,
            @RequestParam(required = false) String apiId,
            @RequestParam(required = false) String consumerId,
            @RequestParam(required = false) String dateFrom,
            @RequestParam(required = false) String dateTo,
            @RequestParam(required = false) List<Integer> statusCodes,
            @RequestParam(required = false) List<String> groupBy) {

        ReportQueryRequest request = buildRequestFromParams(metrics, apiId, consumerId,
                dateFrom, dateTo, statusCodes, groupBy);
        validateRequest(request);

        QueryComponents qc = buildQueryComponents(request);
        List<Map<String, Object>> results = store.executeReportQuery(
                qc.selectClauses, qc.groupByClauses, qc.whereClause, qc.params, 1000);
        String csv = toCsv(results);

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=analytics-report.csv")
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(csv);
    }

    // ── Query Building ──────────────────────────────────────────────────

    private QueryComponents buildQueryComponents(ReportQueryRequest request) {
        List<Object> params = new ArrayList<>();
        List<String> selectClauses = new ArrayList<>();
        List<String> groupByClauses = new ArrayList<>();
        List<String> whereClauses = new ArrayList<>();

        // Always start with a base condition
        whereClauses.add("1=1");

        // Process groupBy columns
        if (request.getGroupBy() != null) {
            for (String gb : request.getGroupBy()) {
                String sanitized = gb.toLowerCase().trim();
                if (!ALLOWED_GROUP_BY.contains(sanitized)) {
                    throw new IllegalArgumentException("Invalid groupBy column: " + gb);
                }
                switch (sanitized) {
                    case "day" -> {
                        selectClauses.add("DATE(created_at) AS day");
                        groupByClauses.add("DATE(created_at)");
                    }
                    case "hour" -> {
                        selectClauses.add("DATE_TRUNC('hour', created_at) AS hour");
                        groupByClauses.add("DATE_TRUNC('hour', created_at)");
                    }
                    case "api_id" -> {
                        selectClauses.add("api_id");
                        groupByClauses.add("api_id");
                    }
                    case "consumer_id" -> {
                        selectClauses.add("consumer_id");
                        groupByClauses.add("consumer_id");
                    }
                    case "status_code" -> {
                        selectClauses.add("status_code");
                        groupByClauses.add("status_code");
                    }
                    case "method" -> {
                        selectClauses.add("method");
                        groupByClauses.add("method");
                    }
                    case "path" -> {
                        selectClauses.add("path");
                        groupByClauses.add("path");
                    }
                    case "week" -> {
                        selectClauses.add("DATE_TRUNC('week', created_at) AS week");
                        groupByClauses.add("DATE_TRUNC('week', created_at)");
                    }
                    case "month" -> {
                        selectClauses.add("DATE_TRUNC('month', created_at) AS month");
                        groupByClauses.add("DATE_TRUNC('month', created_at)");
                    }
                    case "auth_type" -> {
                        selectClauses.add("auth_type");
                        groupByClauses.add("auth_type");
                    }
                }
            }
        }

        // Process metrics
        List<String> metrics = request.getMetrics();
        if (metrics == null || metrics.isEmpty()) {
            metrics = List.of("request_count");
        }
        for (String metric : metrics) {
            String sanitized = metric.toLowerCase().trim();
            if (!ALLOWED_METRICS.contains(sanitized)) {
                throw new IllegalArgumentException("Invalid metric: " + metric);
            }
            switch (sanitized) {
                case "request_count" -> selectClauses.add("COUNT(*) AS request_count");
                case "avg_latency" -> selectClauses.add("ROUND(AVG(latency_ms)::numeric, 2) AS avg_latency");
                case "error_rate" -> selectClauses.add(
                        "ROUND(COALESCE(COUNT(*) FILTER (WHERE status_code >= 400) * 100.0 "
                                + "/ NULLIF(COUNT(*), 0), 0)::numeric, 2) AS error_rate");
                case "p99_latency" -> selectClauses.add(
                        "ROUND(COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms), 0)::numeric, 2) "
                                + "AS p99_latency");
            }
        }

        // Process filters
        Map<String, Object> filters = request.getFilters();
        if (filters != null) {
            if (filters.containsKey("apiId") && filters.get("apiId") != null) {
                whereClauses.add("api_id = ?");
                params.add(UUID.fromString(filters.get("apiId").toString()));
            }
            if (filters.containsKey("consumerId") && filters.get("consumerId") != null) {
                whereClauses.add("consumer_id = ?");
                params.add(UUID.fromString(filters.get("consumerId").toString()));
            }
            if (filters.containsKey("dateFrom") && filters.get("dateFrom") != null) {
                whereClauses.add("created_at >= ?::timestamp");
                params.add(filters.get("dateFrom").toString());
            }
            if (filters.containsKey("dateTo") && filters.get("dateTo") != null) {
                whereClauses.add("created_at < (?::date + INTERVAL '1 day')");
                params.add(filters.get("dateTo").toString());
            }
            if (filters.containsKey("statusCodes") && filters.get("statusCodes") != null) {
                @SuppressWarnings("unchecked")
                List<Integer> codes = (List<Integer>) filters.get("statusCodes");
                if (!codes.isEmpty()) {
                    String placeholders = String.join(",", codes.stream().map(c -> "?").toList());
                    whereClauses.add("status_code IN (" + placeholders + ")");
                    params.addAll(codes);
                }
            }
        }

        String whereClause = String.join(" AND ", whereClauses);
        log.debug("Built report query components: select={}, groupBy={}, where={}", selectClauses, groupByClauses, whereClause);
        return new QueryComponents(selectClauses, groupByClauses, whereClause, params);
    }

    private void validateRequest(ReportQueryRequest request) {
        if (request.getMetrics() != null) {
            for (String metric : request.getMetrics()) {
                if (!ALLOWED_METRICS.contains(metric.toLowerCase().trim())) {
                    throw new IllegalArgumentException("Invalid metric: " + metric
                            + ". Allowed: " + ALLOWED_METRICS);
                }
            }
        }
        if (request.getGroupBy() != null) {
            for (String gb : request.getGroupBy()) {
                if (!ALLOWED_GROUP_BY.contains(gb.toLowerCase().trim())) {
                    throw new IllegalArgumentException("Invalid groupBy: " + gb
                            + ". Allowed: " + ALLOWED_GROUP_BY);
                }
            }
        }
    }

    private ReportQueryRequest buildRequestFromParams(List<String> metrics, String apiId,
                                                       String consumerId, String dateFrom,
                                                       String dateTo, List<Integer> statusCodes,
                                                       List<String> groupBy) {
        Map<String, Object> filters = new LinkedHashMap<>();
        if (apiId != null) filters.put("apiId", apiId);
        if (consumerId != null) filters.put("consumerId", consumerId);
        if (dateFrom != null) filters.put("dateFrom", dateFrom);
        if (dateTo != null) filters.put("dateTo", dateTo);
        if (statusCodes != null && !statusCodes.isEmpty()) filters.put("statusCodes", statusCodes);

        return ReportQueryRequest.builder()
                .metrics(metrics != null ? metrics : List.of("request_count"))
                .filters(filters.isEmpty() ? null : filters)
                .groupBy(groupBy)
                .format("csv")
                .build();
    }

    // ── CSV Export ──────────────────────────────────────────────────────

    private String toCsv(List<Map<String, Object>> results) {
        if (results.isEmpty()) {
            return "";
        }

        StringBuilder csv = new StringBuilder();

        // Header row
        Set<String> columns = results.get(0).keySet();
        csv.append(String.join(",", columns)).append("\n");

        // Data rows
        for (Map<String, Object> row : results) {
            csv.append(columns.stream()
                    .map(col -> {
                        Object val = row.get(col);
                        if (val == null) return "";
                        String str = val.toString();
                        // Escape CSV values containing commas or quotes
                        if (str.contains(",") || str.contains("\"") || str.contains("\n")) {
                            return "\"" + str.replace("\"", "\"\"") + "\"";
                        }
                        return str;
                    })
                    .collect(Collectors.joining(","))
            ).append("\n");
        }

        return csv.toString();
    }

    private record QueryComponents(List<String> selectClauses, List<String> groupByClauses,
                                   String whereClause, List<Object> params) {}
}

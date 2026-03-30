package com.gateway.analytics.service;

import com.gateway.analytics.store.RequestLogStore;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class ReportSchedulerService {

    private final RequestLogStore store;
    private final JavaMailSender mailSender;

    @Value("${spring.mail.properties.mail.smtp.from:noreply@example.com}")
    private String mailFrom;

    @Value("${gateway.reports.daily.enabled:true}")
    private boolean dailyEnabled;

    @Value("${gateway.reports.daily.recipients:admin@gateway.local}")
    private String dailyRecipients;

    @Value("${gateway.reports.weekly.enabled:true}")
    private boolean weeklyEnabled;

    @Value("${gateway.reports.weekly.recipients:admin@gateway.local}")
    private String weeklyRecipients;

    @Value("${gateway.reports.monthly.enabled:true}")
    private boolean monthlyEnabled;

    @Value("${gateway.reports.monthly.recipients:admin@gateway.local}")
    private String monthlyRecipients;

    // ── Scheduled Triggers ──────────────────────────────────────────────

    @Scheduled(cron = "0 0 8 * * *")
    public void sendDailyReport() {
        if (!dailyEnabled) {
            log.debug("Daily report is disabled, skipping");
            return;
        }
        log.info("Generating daily report");
        String html = generateReportHtml("Daily", "24 hours");
        sendReport("Daily Gateway Report - " + formatDate(Instant.now()), html, dailyRecipients);
    }

    @Scheduled(cron = "0 0 8 * * MON")
    public void sendWeeklyReport() {
        if (!weeklyEnabled) {
            log.debug("Weekly report is disabled, skipping");
            return;
        }
        log.info("Generating weekly report");
        String html = generateReportHtml("Weekly", "7 days");
        sendReport("Weekly Gateway Report - " + formatDate(Instant.now()), html, weeklyRecipients);
    }

    @Scheduled(cron = "0 0 8 1 * *")
    public void sendMonthlyReport() {
        if (!monthlyEnabled) {
            log.debug("Monthly report is disabled, skipping");
            return;
        }
        log.info("Generating monthly report");
        String html = generateReportHtml("Monthly", "30 days");
        sendReport("Monthly Gateway Report - " + formatDate(Instant.now()), html, monthlyRecipients);
    }

    // ── Public API for manual triggering ────────────────────────────────

    public void triggerReport(String type) {
        switch (type.toLowerCase()) {
            case "daily" -> {
                log.info("Manually triggering daily report");
                String html = generateReportHtml("Daily", "24 hours");
                sendReport("Daily Gateway Report (Manual) - " + formatDate(Instant.now()), html, dailyRecipients);
            }
            case "weekly" -> {
                log.info("Manually triggering weekly report");
                String html = generateReportHtml("Weekly", "7 days");
                sendReport("Weekly Gateway Report (Manual) - " + formatDate(Instant.now()), html, weeklyRecipients);
            }
            case "monthly" -> {
                log.info("Manually triggering monthly report");
                String html = generateReportHtml("Monthly", "30 days");
                sendReport("Monthly Gateway Report (Manual) - " + formatDate(Instant.now()), html, monthlyRecipients);
            }
            default -> throw new IllegalArgumentException("Unknown report type: " + type
                    + ". Supported types: daily, weekly, monthly");
        }
    }

    // ── Config Accessors ────────────────────────────────────────────────

    public Map<String, Object> getConfig() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("daily", Map.of(
                "enabled", dailyEnabled,
                "recipients", parseRecipients(dailyRecipients)));
        config.put("weekly", Map.of(
                "enabled", weeklyEnabled,
                "recipients", parseRecipients(weeklyRecipients)));
        config.put("monthly", Map.of(
                "enabled", monthlyEnabled,
                "recipients", parseRecipients(monthlyRecipients)));
        return config;
    }

    public void updateRecipients(List<String> daily, List<String> weekly, List<String> monthly) {
        if (daily != null && !daily.isEmpty()) {
            this.dailyRecipients = String.join(",", daily);
            log.info("Updated daily recipients: {}", this.dailyRecipients);
        }
        if (weekly != null && !weekly.isEmpty()) {
            this.weeklyRecipients = String.join(",", weekly);
            log.info("Updated weekly recipients: {}", this.weeklyRecipients);
        }
        if (monthly != null && !monthly.isEmpty()) {
            this.monthlyRecipients = String.join(",", monthly);
            log.info("Updated monthly recipients: {}", this.monthlyRecipients);
        }
    }

    // ── HTML Report Generation ──────────────────────────────────────────

    String generateReportHtml(String reportType, String interval) {
        // Summary stats
        Map<String, Object> summary = store.getReportSummary(interval);
        long totalRequests = ((Number) summary.get("total_requests")).longValue();
        double errorRate = ((Number) summary.get("error_rate")).doubleValue();
        double avgLatency = ((Number) summary.get("avg_latency")).doubleValue();

        // Top 5 APIs by traffic
        List<Map<String, Object>> topApis = store.getReportTopApis(interval, 5);

        // Top 5 errors
        List<Map<String, Object>> topErrors = store.getReportTopErrors(interval, 5);

        // SLA violations (latency > 1000ms or error_rate > 5%)
        List<Map<String, Object>> slaViolations = store.getReportSlaViolations(interval);

        StringBuilder html = new StringBuilder();
        html.append("<!DOCTYPE html><html><head><meta charset='UTF-8'>");
        html.append("<style>");
        html.append("body { font-family: Arial, sans-serif; margin: 20px; color: #333; }");
        html.append("h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }");
        html.append("h2 { color: #2c3e50; margin-top: 30px; }");
        html.append("table { border-collapse: collapse; width: 100%; margin: 10px 0; }");
        html.append("th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }");
        html.append("th { background-color: #3498db; color: white; }");
        html.append("tr:nth-child(even) { background-color: #f2f2f2; }");
        html.append(".stat-box { display: inline-block; padding: 15px 25px; margin: 5px; ");
        html.append("background: #ecf0f1; border-radius: 5px; text-align: center; }");
        html.append(".stat-value { font-size: 24px; font-weight: bold; color: #2c3e50; }");
        html.append(".stat-label { font-size: 12px; color: #7f8c8d; }");
        html.append(".warning { color: #e74c3c; font-weight: bold; }");
        html.append("</style></head><body>");

        // Header
        html.append("<h1>").append(reportType).append(" Gateway Report</h1>");
        html.append("<p>Generated at: ").append(formatDateTime(Instant.now()))
                .append(" | Period: last ").append(interval).append("</p>");

        // Summary Stats
        html.append("<h2>Summary</h2>");
        html.append("<div>");
        html.append("<div class='stat-box'><div class='stat-value'>").append(totalRequests)
                .append("</div><div class='stat-label'>Total Requests</div></div>");
        html.append("<div class='stat-box'><div class='stat-value'>")
                .append(String.format("%.2f%%", errorRate))
                .append("</div><div class='stat-label'>Error Rate</div></div>");
        html.append("<div class='stat-box'><div class='stat-value'>")
                .append(String.format("%.1fms", avgLatency))
                .append("</div><div class='stat-label'>Avg Latency</div></div>");
        html.append("</div>");

        // Top 5 APIs
        html.append("<h2>Top 5 APIs by Traffic</h2>");
        html.append("<table><tr><th>API ID</th><th>Requests</th><th>Errors</th>")
                .append("<th>Avg Latency (ms)</th><th>Error Rate (%)</th></tr>");
        for (Map<String, Object> api : topApis) {
            html.append("<tr>");
            html.append("<td>").append(api.get("api_id")).append("</td>");
            html.append("<td>").append(api.get("request_count")).append("</td>");
            html.append("<td>").append(api.get("error_count")).append("</td>");
            html.append("<td>").append(String.format("%.1f",
                    ((Number) api.get("avg_latency")).doubleValue())).append("</td>");
            html.append("<td>").append(String.format("%.2f",
                    ((Number) api.get("error_rate")).doubleValue())).append("</td>");
            html.append("</tr>");
        }
        html.append("</table>");

        // Top 5 Errors
        html.append("<h2>Top 5 Errors</h2>");
        html.append("<table><tr><th>Status Code</th><th>Error Code</th><th>Count</th></tr>");
        for (Map<String, Object> error : topErrors) {
            html.append("<tr>");
            html.append("<td>").append(error.get("status_code")).append("</td>");
            html.append("<td>").append(error.getOrDefault("error_code", "N/A")).append("</td>");
            html.append("<td>").append(error.get("cnt")).append("</td>");
            html.append("</tr>");
        }
        html.append("</table>");

        // SLA Violations
        if (!slaViolations.isEmpty()) {
            html.append("<h2 class='warning'>SLA Violations</h2>");
            html.append("<table><tr><th>API ID</th><th>Avg Latency (ms)</th>")
                    .append("<th>Error Rate (%)</th><th>Violation</th></tr>");
            for (Map<String, Object> violation : slaViolations) {
                html.append("<tr>");
                html.append("<td>").append(violation.get("api_id")).append("</td>");
                html.append("<td>").append(String.format("%.1f",
                        ((Number) violation.get("avg_latency")).doubleValue())).append("</td>");
                html.append("<td>").append(String.format("%.2f",
                        ((Number) violation.get("error_rate")).doubleValue())).append("</td>");
                html.append("<td class='warning'>").append(violation.get("violation")).append("</td>");
                html.append("</tr>");
            }
            html.append("</table>");
        } else {
            html.append("<h2>SLA Violations</h2>");
            html.append("<p style='color: #27ae60;'>No SLA violations detected.</p>");
        }

        html.append("</body></html>");
        return html.toString();
    }

    // ── Email Sending ───────────────────────────────────────────────────

    private void sendReport(String subject, String htmlBody, String recipients) {
        String[] recipientArray = parseRecipients(recipients).toArray(new String[0]);
        if (recipientArray.length == 0) {
            log.warn("No recipients configured for report: {}", subject);
            return;
        }

        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(mailFrom);
            helper.setTo(recipientArray);
            helper.setSubject(subject);
            helper.setText(htmlBody, true);
            mailSender.send(message);
            log.info("Report sent successfully to {} recipients: {}", recipientArray.length, subject);
        } catch (MessagingException e) {
            log.error("Failed to send report email '{}': {}", subject, e.getMessage(), e);
        }
    }

    private List<String> parseRecipients(String recipients) {
        if (recipients == null || recipients.isBlank()) {
            return List.of();
        }
        return Arrays.stream(recipients.split("[,;\\s]+"))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    private String formatDate(Instant instant) {
        return DateTimeFormatter.ofPattern("yyyy-MM-dd")
                .withZone(ZoneId.systemDefault())
                .format(instant);
    }

    private String formatDateTime(Instant instant) {
        return DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss z")
                .withZone(ZoneId.systemDefault())
                .format(instant);
    }
}

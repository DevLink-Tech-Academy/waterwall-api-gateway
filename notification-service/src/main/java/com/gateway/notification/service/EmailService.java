package com.gateway.notification.service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

import java.util.Map;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final JavaMailSender mailSender;
    private final TemplateEngine templateEngine;

    public EmailService(JavaMailSender mailSender, TemplateEngine templateEngine) {
        this.mailSender = mailSender;
        this.templateEngine = templateEngine;
    }

    /**
     * Renders an HTML email from a Thymeleaf template and sends it.
     * Failures are caught and logged — they never propagate to the caller.
     */
    public void sendEmail(String to, String templateName, Map<String, Object> variables) {
        try {
            Context ctx = new Context();
            if (variables != null) {
                ctx.setVariables(variables);
            }

            String htmlBody = templateEngine.process("email/" + templateName, ctx);

            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setTo(to);
            helper.setSubject(resolveSubject(templateName, variables));
            helper.setText(htmlBody, true);
            helper.setFrom("noreply@apigateway.io");

            mailSender.send(message);
            log.info("Email sent successfully to={} template={}", to, templateName);
        } catch (MessagingException ex) {
            log.error("Failed to send email to={} template={}: {}", to, templateName, ex.getMessage(), ex);
        } catch (Exception ex) {
            log.error("Unexpected error sending email to={} template={}: {}", to, templateName, ex.getMessage(), ex);
        }
    }

    private String resolveSubject(String templateName, Map<String, Object> variables) {
        if (variables != null && variables.containsKey("subject")) {
            return variables.get("subject").toString();
        }
        return switch (templateName) {
            case "email-verification" -> "Verify your email";
            case "password-reset" -> "Reset your password";
            case "welcome" -> "Welcome to API Gateway";
            case "subscription-approved" -> "Your subscription has been approved";
            case "api-key-expiring" -> "Your API key is expiring soon";
            case "account-locked" -> "Your account has been locked";
            case "invoice-generated" -> "New Invoice Generated";
            case "payment-failed" -> "Payment Failed - Action Required";
            case "payment-success" -> "Payment Confirmed";
            case "subscription-suspended" -> "Subscription Suspended";
            default -> "API Gateway Notification";
        };
    }
}

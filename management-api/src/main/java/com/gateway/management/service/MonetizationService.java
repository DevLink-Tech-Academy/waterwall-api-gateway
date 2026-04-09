package com.gateway.management.service;

import com.gateway.management.entity.CreditNoteEntity;
import com.gateway.management.entity.InvoiceEntity;
import com.gateway.management.entity.PlanEntity;
import com.gateway.management.repository.CreditNoteRepository;
import com.gateway.management.repository.InvoiceRepository;
import com.gateway.management.repository.PaymentMethodRepository;
import com.gateway.management.repository.PlanRepository;
import com.gateway.management.service.payment.PaymentProvider;
import com.gateway.management.service.payment.PaymentProviderFactory;
import com.gateway.management.service.payment.PaymentResult;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import jakarta.persistence.Query;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class MonetizationService {

    private final PlanRepository planRepository;
    private final InvoiceRepository invoiceRepository;
    private final PaymentMethodRepository paymentMethodRepository;
    private final CreditNoteRepository creditNoteRepository;
    private final PaymentProviderFactory paymentProviderFactory;
    private final PaymentGatewaySettingsService paymentGatewaySettingsService;
    private final EntityManager entityManager;

    // ── Invoice Generation ────────────────────────────────────────────────

    @Transactional
    public InvoiceEntity generateInvoice(UUID consumerId, String period) {
        // Parse period (e.g., "2026-03") into billing start/end
        YearMonth ym = YearMonth.parse(period);
        LocalDate start = ym.atDay(1);
        LocalDate end = ym.atEndOfMonth();

        // Idempotency: check if invoice already exists for this consumer+period
        Optional<InvoiceEntity> existing = invoiceRepository
                .findByConsumerIdAndBillingPeriodStartAndBillingPeriodEnd(consumerId, start, end);
        if (existing.isPresent()) {
            log.info("Invoice already exists for consumer={} period={}, returning existing invoice={}",
                    consumerId, period, existing.get().getId());
            return existing.get();
        }

        // Query actual request count from analytics.request_logs for this consumer and period
        long requestCount = queryRequestCount(consumerId, start, end);

        // Resolve the plan for this consumer via their subscription
        PlanEntity plan = resolvePricingPlan(consumerId);

        // Calculate cost based on the pricing model
        BigDecimal totalAmount = calculateCost(plan, requestCount);
        String currency = plan != null && plan.getCurrency() != null ? plan.getCurrency() : paymentGatewaySettingsService.getDefaultCurrency();

        // Build line items JSON
        String lineItemsJson = buildLineItemsJson(plan, requestCount, totalAmount);

        InvoiceEntity invoice = InvoiceEntity.builder()
                .consumerId(consumerId)
                .billingPeriodStart(start)
                .billingPeriodEnd(end)
                .totalAmount(totalAmount)
                .currency(currency)
                .status("DRAFT")
                .lineItems(lineItemsJson)
                .build();

        invoice = invoiceRepository.save(invoice);
        log.info("Generated invoice: id={} consumerId={} period={} requests={} amount={}",
                invoice.getId(), consumerId, period, requestCount, totalAmount);
        return invoice;
    }

    public List<InvoiceEntity> listInvoices(UUID consumerId) {
        return invoiceRepository.findByConsumerId(consumerId);
    }

    // ── Revenue Report ────────────────────────────────────────────────────

    public Map<String, Object> getRevenueReport(String period) {
        List<InvoiceEntity> periodInvoices = getInvoicesForPeriod(period);

        // Group revenue by currency
        Map<String, BigDecimal> totalByCurrency = periodInvoices.stream()
                .collect(Collectors.groupingBy(
                        inv -> inv.getCurrency() != null ? inv.getCurrency() : paymentGatewaySettingsService.getDefaultCurrency(),
                        LinkedHashMap::new,
                        Collectors.reducing(BigDecimal.ZERO, InvoiceEntity::getTotalAmount, BigDecimal::add)
                ));

        Map<String, BigDecimal> perPlanRevenue = buildPerPlanRevenue(periodInvoices);

        Map<String, BigDecimal> revenueByStatus = periodInvoices.stream()
                .collect(Collectors.groupingBy(
                        inv -> inv.getStatus() != null ? inv.getStatus() : "UNKNOWN",
                        LinkedHashMap::new,
                        Collectors.reducing(BigDecimal.ZERO, InvoiceEntity::getTotalAmount, BigDecimal::add)
                ));

        // Compute totals for backwards compatibility with admin UI
        BigDecimal totalRevenue = periodInvoices.stream()
                .map(InvoiceEntity::getTotalAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        long paidCount = periodInvoices.stream()
                .filter(inv -> "PAID".equals(inv.getStatus()))
                .count();

        BigDecimal paidTotal = periodInvoices.stream()
                .filter(inv -> "PAID".equals(inv.getStatus()))
                .map(InvoiceEntity::getTotalAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal outstanding = periodInvoices.stream()
                .filter(inv -> !"PAID".equals(inv.getStatus()) && !"REFUNDED".equals(inv.getStatus()))
                .map(InvoiceEntity::getTotalAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal averagePerInvoice = periodInvoices.isEmpty()
                ? BigDecimal.ZERO
                : totalRevenue.divide(BigDecimal.valueOf(periodInvoices.size()), 2, java.math.RoundingMode.HALF_UP);

        String defaultCurrency = paymentGatewaySettingsService.getDefaultCurrency();

        // Build per-plan breakdown with invoice counts
        List<Map<String, Object>> byPlan = new java.util.ArrayList<>();
        for (Map.Entry<String, BigDecimal> entry : perPlanRevenue.entrySet()) {
            long planInvoiceCount = periodInvoices.stream()
                    .filter(inv -> inv.getLineItems() != null && inv.getLineItems().toString().contains(entry.getKey()))
                    .count();
            byPlan.add(Map.of(
                    "planName", entry.getKey(),
                    "planId", entry.getKey(),
                    "revenue", entry.getValue(),
                    "invoiceCount", planInvoiceCount
            ));
        }

        Map<String, Object> report = new LinkedHashMap<>();
        report.put("period", period);
        report.put("totalRevenue", totalRevenue);
        report.put("currency", defaultCurrency);
        report.put("paidInvoices", paidCount);
        report.put("outstanding", outstanding);
        report.put("averagePerInvoice", averagePerInvoice);
        report.put("invoiceCount", periodInvoices.size());
        report.put("totalRevenueByCurrency", totalByCurrency);
        report.put("perPlanBreakdown", perPlanRevenue);
        report.put("byPlan", byPlan);
        report.put("revenueByStatus", revenueByStatus);

        log.info("Generated revenue report for period={} invoices={}", period, periodInvoices.size());
        return report;
    }

    // ── Refund ────────────────────────────────────────────────────────────

    @Transactional
    public CreditNoteEntity refundInvoice(UUID invoiceId, BigDecimal amount, String reason) {
        InvoiceEntity invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new EntityNotFoundException("Invoice not found: " + invoiceId));

        if (!"PAID".equals(invoice.getStatus())) {
            throw new IllegalStateException("Can only refund PAID invoices. Current status: " + invoice.getStatus());
        }

        BigDecimal refundAmount = amount != null ? amount : invoice.getTotalAmount();

        String refundReference = null;
        if (invoice.getPaystackReference() != null) {
            try {
                PaymentProvider provider = paymentProviderFactory.getActiveProvider();
                PaymentResult.RefundResult result = provider.refund(
                        invoice.getPaystackReference(), refundAmount);
                if (result.isSuccessful()) {
                    refundReference = result.getRefundReference();
                } else {
                    log.warn("Payment provider refund failed: {}", result.getMessage());
                }
            } catch (Exception e) {
                log.error("Refund processing failed for invoice {}: {}", invoiceId, e.getMessage());
            }
        }

        boolean isFullRefund = refundAmount.compareTo(invoice.getTotalAmount()) >= 0;
        invoice.setStatus(isFullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED");
        invoiceRepository.save(invoice);

        CreditNoteEntity creditNote = CreditNoteEntity.builder()
                .invoiceId(invoiceId)
                .consumerId(invoice.getConsumerId())
                .amount(refundAmount)
                .currency(invoice.getCurrency())
                .reason(reason)
                .refundReference(refundReference)
                .build();

        CreditNoteEntity saved = creditNoteRepository.save(creditNote);
        log.info("Refund processed: creditNote={} invoice={} amount={}", saved.getId(), invoiceId, refundAmount);
        return saved;
    }

    // ── Private Helpers ───────────────────────────────────────────────────

    /**
     * Queries the actual request count from analytics.request_logs for a given
     * consumer within the specified billing date range.
     */
    private long queryRequestCount(UUID consumerId, LocalDate start, LocalDate end) {
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT COUNT(*) FROM analytics.request_logs " +
                    "WHERE consumer_id = :consumerId " +
                    "AND (mock_mode IS NULL OR mock_mode = false) " +
                    "AND created_at >= :start " +
                    "AND created_at < :endExclusive"
            );
            query.setParameter("consumerId", consumerId);
            query.setParameter("start", start.atStartOfDay());
            // Use the day after billing period end for exclusive upper bound
            query.setParameter("endExclusive", end.plusDays(1).atStartOfDay());
            Number result = (Number) query.getSingleResult();
            return result != null ? result.longValue() : 0L;
        } catch (Exception e) {
            log.warn("Failed to query request count from analytics.request_logs for consumer={}: {}",
                    consumerId, e.getMessage());
            return 0L;
        }
    }

    /**
     * Resolves the pricing plan for a consumer. Looks up the consumer's active
     * subscription and joins to gateway.plans (which now holds pricing data).
     * Falls back to the first available plan if no subscription is found.
     */
    private PlanEntity resolvePricingPlan(UUID consumerId) {
        // Attempt to find the plan linked through the consumer's subscription
        try {
            Query query = entityManager.createNativeQuery(
                    "SELECT p.* FROM gateway.plans p " +
                    "JOIN gateway.subscriptions s ON s.plan_id = p.id " +
                    "WHERE s.application_id = :consumerId " +
                    "AND s.status = 'APPROVED' " +
                    "ORDER BY s.created_at DESC LIMIT 1",
                    PlanEntity.class
            );
            query.setParameter("consumerId", consumerId);
            List<?> results = query.getResultList();
            if (!results.isEmpty()) {
                return (PlanEntity) results.get(0);
            }
        } catch (Exception e) {
            log.debug("No subscription-linked plan found for consumer={}: {}", consumerId, e.getMessage());
        }

        // Fall back to the first available plan
        List<PlanEntity> plans = planRepository.findAll();
        if (!plans.isEmpty()) {
            log.debug("Using default plan '{}' for consumer={}", plans.get(0).getName(), consumerId);
            return plans.get(0);
        }
        return null;
    }

    private BigDecimal calculateCost(PlanEntity plan, long requestCount) {
        return PricingCalculator.calculateCost(plan, requestCount);
    }

    /**
     * Builds a JSON string of line items for the invoice.
     */
    private String buildLineItemsJson(PlanEntity plan, long requestCount, BigDecimal totalAmount) {
        if (plan == null) {
            return "[{\"description\":\"API requests (no plan)\",\"quantity\":" + requestCount
                    + ",\"amount\":" + totalAmount + "}]";
        }

        String model = plan.getPricingModel() != null ? plan.getPricingModel().toUpperCase() : "FREE";
        long includedRequests = plan.getIncludedRequests() != null ? plan.getIncludedRequests() : 0L;
        BigDecimal priceAmount = plan.getPriceAmount() != null ? plan.getPriceAmount() : BigDecimal.ZERO;
        BigDecimal overageRate = plan.getOverageRate() != null ? plan.getOverageRate() : BigDecimal.ZERO;

        StringBuilder sb = new StringBuilder("[");

        switch (model) {
            case "FREE":
                sb.append("{\"description\":\"Free tier\",\"quantity\":").append(requestCount)
                        .append(",\"amount\":0}");
                break;

            case "FLAT_RATE":
                sb.append("{\"description\":\"Flat rate - ").append(plan.getName())
                        .append("\",\"quantity\":1,\"amount\":").append(priceAmount).append("}");
                if (requestCount > 0) {
                    sb.append(",{\"description\":\"API requests (included)\",\"quantity\":")
                            .append(requestCount).append(",\"amount\":0}");
                }
                break;

            case "PAY_PER_USE":
                sb.append("{\"description\":\"API requests @ ").append(overageRate).append("/req")
                        .append("\",\"quantity\":").append(requestCount)
                        .append(",\"amount\":").append(totalAmount).append("}");
                break;

            case "TIERED":
                sb.append("{\"description\":\"Base fee - ").append(plan.getName())
                        .append(" (includes ").append(includedRequests).append(" requests)")
                        .append("\",\"quantity\":1,\"amount\":").append(priceAmount).append("}");
                if (requestCount > includedRequests) {
                    long overage = requestCount - includedRequests;
                    BigDecimal overageAmount = overageRate.multiply(BigDecimal.valueOf(overage))
                            .setScale(2, RoundingMode.HALF_UP);
                    sb.append(",{\"description\":\"Overage requests @ ").append(overageRate).append("/req")
                            .append("\",\"quantity\":").append(overage)
                            .append(",\"amount\":").append(overageAmount).append("}");
                }
                break;

            case "FREEMIUM":
                sb.append("{\"description\":\"Free included requests\",\"quantity\":")
                        .append(Math.min(requestCount, includedRequests))
                        .append(",\"amount\":0}");
                if (requestCount > includedRequests) {
                    long overage = requestCount - includedRequests;
                    BigDecimal overageAmount = overageRate.multiply(BigDecimal.valueOf(overage))
                            .setScale(2, RoundingMode.HALF_UP);
                    sb.append(",{\"description\":\"Overage requests @ ").append(overageRate).append("/req")
                            .append("\",\"quantity\":").append(overage)
                            .append(",\"amount\":").append(overageAmount).append("}");
                }
                break;

            default:
                sb.append("{\"description\":\"API requests\",\"quantity\":").append(requestCount)
                        .append(",\"amount\":").append(totalAmount).append("}");
                break;
        }

        sb.append("]");
        return sb.toString();
    }

    /**
     * Retrieves invoices for the given period. Supports "monthly" (current month),
     * "YYYY-MM" (specific month), or "YYYY" (full year).
     */
    private List<InvoiceEntity> getInvoicesForPeriod(String period) {
        List<InvoiceEntity> allInvoices = invoiceRepository.findAll();

        if (period == null || period.isBlank() || "monthly".equalsIgnoreCase(period)) {
            // Current month
            YearMonth current = YearMonth.now();
            LocalDate monthStart = current.atDay(1);
            LocalDate monthEnd = current.atEndOfMonth();
            return allInvoices.stream()
                    .filter(inv -> !inv.getBillingPeriodStart().isBefore(monthStart)
                            && !inv.getBillingPeriodEnd().isAfter(monthEnd))
                    .collect(Collectors.toList());
        }

        // Try "YYYY-MM" format
        if (period.matches("\\d{4}-\\d{2}")) {
            YearMonth ym = YearMonth.parse(period);
            LocalDate monthStart = ym.atDay(1);
            LocalDate monthEnd = ym.atEndOfMonth();
            return allInvoices.stream()
                    .filter(inv -> !inv.getBillingPeriodStart().isBefore(monthStart)
                            && !inv.getBillingPeriodEnd().isAfter(monthEnd))
                    .collect(Collectors.toList());
        }

        // Try "YYYY" format (full year)
        if (period.matches("\\d{4}")) {
            int year = Integer.parseInt(period);
            LocalDate yearStart = LocalDate.of(year, 1, 1);
            LocalDate yearEnd = LocalDate.of(year, 12, 31);
            return allInvoices.stream()
                    .filter(inv -> !inv.getBillingPeriodStart().isBefore(yearStart)
                            && !inv.getBillingPeriodEnd().isAfter(yearEnd))
                    .collect(Collectors.toList());
        }

        // Unrecognized period format -- return all invoices
        log.warn("Unrecognized period format '{}'; returning all invoices", period);
        return allInvoices;
    }

    /**
     * Builds a per-plan revenue breakdown by matching each invoice's line items
     * to known plans. Invoices whose plan cannot be determined are grouped
     * under "Unassigned".
     */
    private Map<String, BigDecimal> buildPerPlanRevenue(List<InvoiceEntity> invoices) {
        Map<String, BigDecimal> perPlan = new LinkedHashMap<>();
        List<PlanEntity> plans = planRepository.findAll();
        for (PlanEntity plan : plans) {
            // Initialize all plans with zero
            perPlan.put(plan.getName(), BigDecimal.ZERO);
        }

        for (InvoiceEntity invoice : invoices) {
            String matchedPlan = null;

            // Try to match the invoice to a plan by inspecting line items description
            if (invoice.getLineItems() != null) {
                for (PlanEntity plan : plans) {
                    if (invoice.getLineItems().contains(plan.getName())) {
                        matchedPlan = plan.getName();
                        break;
                    }
                }
            }

            if (matchedPlan == null) {
                matchedPlan = "Unassigned";
            }
            perPlan.merge(matchedPlan, invoice.getTotalAmount(), BigDecimal::add);
        }

        return perPlan;
    }
}

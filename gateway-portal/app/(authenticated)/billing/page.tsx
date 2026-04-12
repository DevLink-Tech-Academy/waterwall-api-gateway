'use client';

import React, { useEffect, useState, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token') || localStorage.getItem('admin_token') || localStorage.getItem('jwt_token');
}
function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

/* ---------- types ---------- */

interface UsageSummary {
  requestsToday: number;
  requestsThisWeek: number;
  requestsThisMonth: number;
  averageLatencyMs: number;
  errorRate: number;
  activeSubscriptions: number;
  topApis: { apiId: string; apiName: string; requestCount: number }[];
}

interface UsageHistoryEntry {
  date: string;
  requestCount: number;
  errorCount: number;
  averageLatencyMs: number;
}

interface ApiUsage {
  apiId: string;
  apiName: string;
  totalRequests: number;
  averageLatencyMs: number;
  errorCount: number;
  errorRate: number;
}

interface CostInfo {
  billingPeriodStart: string;
  billingPeriodEnd: string;
  totalRequests: number;
  includedRequests: number;
  overageRequests: number;
  estimatedCost: number;
  currency: string;
  pricingModel: string;
  planName: string;
}

interface InvoiceLineItem {
  description: string;
  quantity: number;
  amount: number;
}

interface Invoice {
  id: string;
  consumerId: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  totalAmount: number;
  currency: string;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  lineItems: string | InvoiceLineItem[];
  createdAt: string;
  paystackReference?: string;
  paidAt?: string;
  paymentMethodId?: string;
}

interface PaymentMethod {
  id: string;
  type: string;
  provider: string;
  providerRef: string;
  isDefault: boolean;
  createdAt: string;
}

interface UsageAlert {
  id: string;
  metric: string;
  condition: string;
  threshold: number;
  enabled: boolean;
}

/* ---------- helpers ---------- */

function fmtCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtPeriod(start: string, end: string): string {
  return `${fmtDate(start)} - ${fmtDate(end)}`;
}

const statusColors: Record<string, { bg: string; fg: string }> = {
  DRAFT: { bg: '#f1f5f9', fg: '#64748b' },
  SENT: { bg: '#dbeafe', fg: '#2563eb' },
  PENDING: { bg: '#fef3c7', fg: '#d97706' },
  PAID: { bg: '#dcfce7', fg: '#16a34a' },
  OVERDUE: { bg: '#fee2e2', fg: '#dc2626' },
  FAILED: { bg: '#fee2e2', fg: '#dc2626' },
  REFUNDED: { bg: '#f0fdf4', fg: '#15803d' },
  PARTIALLY_REFUNDED: { bg: '#fefce8', fg: '#a16207' },
};

const paymentTypeIcons: Record<string, string> = {
  CREDIT_CARD: '\u{1F4B3}',
  BANK_ACCOUNT: '\u{1F3E6}',
  PAYPAL: '\u{1F4B0}',
};

const ALERT_METRICS = ['Quota %', 'Monthly Cost', 'Error Rate', 'Latency P95'];
const ALERT_CONDITIONS = ['>', '>=', '<', '<='];

/* ---------- component ---------- */

export default function BillingPage() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [history, setHistory] = useState<UsageHistoryEntry[]>([]);
  const [apiUsages, setApiUsages] = useState<ApiUsage[]>([]);
  const [cost, setCost] = useState<CostInfo | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  const [loading, setLoading] = useState(true);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});

  // Wallet state
  const [wallet, setWallet] = useState<{ id: string; balance: number; currency: string; autoTopUpEnabled: boolean; autoTopUpThreshold: number; autoTopUpAmount: number; lowBalanceThreshold: number } | null>(null);
  const [walletTxns, setWalletTxns] = useState<{ content: { id: string; type: string; amount: number; currency: string; description: string; balanceAfter: number; createdAt: string }[] }>({ content: [] });
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpLoading, setTopUpLoading] = useState(false);

  // Gateway selection state
  const [enabledGateways, setEnabledGateways] = useState<{ provider: string; displayName: string }[]>([]);
  const [showGatewayPicker, setShowGatewayPicker] = useState(false);
  const [selectedGateway, setSelectedGateway] = useState('');
  const [pendingPayInvoiceId, setPendingPayInvoiceId] = useState<string | null>(null);

  // Billing mode
  const [billingMode, setBillingMode] = useState<'SUBSCRIPTION' | 'PAY_AS_YOU_GO'>('SUBSCRIPTION');

  // Page tab navigation
  const [activeSection, setActiveSection] = useState<'overview' | 'invoices' | 'wallet' | 'settings'>('overview');

  // add payment method form
  const [showAddPm, setShowAddPm] = useState(false);
  const [pmForm, setPmForm] = useState({ type: 'CREDIT_CARD', provider: '', providerRef: '' });
  const [pmSubmitting, setPmSubmitting] = useState(false);
  const [pmError, setPmError] = useState('');

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Usage Alerts state
  const [alerts, setAlerts] = useState<UsageAlert[]>([]);
  const [alertForm, setAlertForm] = useState({ metric: ALERT_METRICS[0], condition: ALERT_CONDITIONS[0], threshold: '' });
  const [alertSubmitting, setAlertSubmitting] = useState(false);
  const [alertError, setAlertError] = useState('');
  const [alertActionLoading, setAlertActionLoading] = useState<string | null>(null);

  const setErr = (key: string, msg: string) =>
    setSectionErrors((prev) => ({ ...prev, [key]: msg }));

  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/consumer/alerts`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAlerts(Array.isArray(data) ? data : []);
      } else {
        setErr('alerts', `Failed to load alerts (${res.status})`);
      }
    } catch (e) {
      setErr('alerts', e instanceof Error ? e.message : 'Network error');
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setSectionErrors({});
    const headers = authHeaders();

    const fetchers: [string, string, (d: unknown) => void][] = [
      ['summary', `${API_BASE}/v1/consumer/usage/summary`, (d) => setSummary(d as UsageSummary)],
      ['history', `${API_BASE}/v1/consumer/usage/history?range=30d`, (d) => setHistory(((d as { data: UsageHistoryEntry[] }).data) || [])],
      ['apis', `${API_BASE}/v1/consumer/usage/apis`, (d) => {
        const list = ((d as { apis: ApiUsage[] }).apis) || [];
        list.sort((a, b) => b.totalRequests - a.totalRequests);
        setApiUsages(list);
      }],
      ['cost', `${API_BASE}/v1/consumer/usage/cost`, (d) => setCost(d as CostInfo)],
      ['invoices', `${API_BASE}/v1/consumer/invoices`, (d) => setInvoices(Array.isArray(d) ? d : [])],
      ['payments', `${API_BASE}/v1/consumer/payment-methods`, (d) => setPaymentMethods(Array.isArray(d) ? d : [])],
      ['wallet', `${API_BASE}/v1/consumer/wallet`, (d) => setWallet(d as typeof wallet)],
      ['gateways', `${API_BASE}/v1/consumer/payment-gateways`, (d) => setEnabledGateways(Array.isArray(d) ? d : [])],
      ['billingMode', `${API_BASE}/v1/consumer/billing-mode`, (d) => setBillingMode(((d as { billingMode: string }).billingMode as 'SUBSCRIPTION' | 'PAY_AS_YOU_GO') || 'SUBSCRIPTION')],
      ['walletTxns', `${API_BASE}/v1/consumer/wallet/transactions?size=10`, (d) => setWalletTxns(d as typeof walletTxns)],
    ];

    await Promise.allSettled(
      fetchers.map(async ([key, url, setter]) => {
        try {
          const res = await fetch(url, { headers });
          if (!res.ok) { setErr(key, `Failed to load (${res.status})`); return; }
          setter(await res.json());
        } catch (e) {
          setErr(key, e instanceof Error ? e.message : 'Network error');
        }
      }),
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    // Check for payment verification callback
    const params = new URLSearchParams(window.location.search);
    const verify = params.get('verify');
    const reference = params.get('reference') || params.get('trxref');
    const providerParam = params.get('provider') || '';
    if (verify === 'true' && reference) {
      const isTopUp = reference.startsWith('TOPUP-');
      const baseVerifyUrl = isTopUp
          ? `${API_BASE}/v1/consumer/wallet/top-up/verify`
          : `${API_BASE}/v1/consumer/payments/verify`;
      const verifyParams = new URLSearchParams({ reference });
      if (providerParam) verifyParams.set('provider', providerParam);
      const verifyUrl = `${baseVerifyUrl}?${verifyParams.toString()}`;

      fetch(verifyUrl, { headers: authHeaders() })
        .then(res => {
          if (res.ok) {
            setVerifyMsg({ type: 'success', text: isTopUp ? 'Wallet topped up successfully!' : 'Payment successful! Your invoice has been marked as paid.' });
            loadAll();
          } else {
            return res.json().then(err => {
              setVerifyMsg({ type: 'error', text: err.message || 'Payment verification failed. Please contact support.' });
            }).catch(() => {
              setVerifyMsg({ type: 'error', text: 'Payment verification failed. Please contact support.' });
            });
          }
        })
        .catch(() => setVerifyMsg({ type: 'error', text: 'Could not verify payment.' }));
      // Clean URL
      window.history.replaceState({}, '', '/billing');
    }
    loadAll();
    loadAlerts();
  }, [loadAll, loadAlerts]);

  /* payment method actions */
  const addPaymentMethod = async () => {
    if (!pmForm.provider.trim() || !pmForm.providerRef.trim()) {
      setPmError('Provider and reference are required.');
      return;
    }
    setPmSubmitting(true);
    setPmError('');
    try {
      const res = await fetch(`${API_BASE}/v1/consumer/payment-methods`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(pmForm),
      });
      if (!res.ok) { setPmError(`Failed to add (${res.status})`); return; }
      setShowAddPm(false);
      setPmForm({ type: 'CREDIT_CARD', provider: '', providerRef: '' });
      // reload payment methods
      const listRes = await fetch(`${API_BASE}/v1/consumer/payment-methods`, { headers: authHeaders() });
      if (listRes.ok) setPaymentMethods(await listRes.json());
    } catch (e) {
      setPmError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setPmSubmitting(false);
    }
  };

  const removePaymentMethod = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/v1/consumer/payment-methods/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) setPaymentMethods((prev) => prev.filter((p) => p.id !== id));
    } catch { /* silent */ }
    finally { setActionLoading(null); }
  };

  const setDefault = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/v1/consumer/payment-methods/${id}/default`, {
        method: 'PATCH',
        headers: authHeaders(),
      });
      if (res.ok) setPaymentMethods((prev) => prev.map((p) => ({ ...p, isDefault: p.id === id })));
    } catch { /* silent */ }
    finally { setActionLoading(null); }
  };

  const handlePayInvoice = async (invoiceId: string, provider?: string) => {
    // If multiple gateways enabled and no provider selected, show picker
    if (!provider && enabledGateways.length > 1) {
      setPendingPayInvoiceId(invoiceId);
      setShowGatewayPicker(true);
      return;
    }

    setPayingInvoiceId(invoiceId);
    setShowGatewayPicker(false);
    try {
      const url = provider
          ? `${API_BASE}/v1/consumer/invoices/${invoiceId}/pay?provider=${provider}`
          : `${API_BASE}/v1/consumer/invoices/${invoiceId}/pay`;
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Payment initiation failed (${res.status})`);
      }
      const data = await res.json();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to initiate payment');
      setPayingInvoiceId(null);
    }
  };

  const confirmGatewayAndPay = () => {
    if (pendingPayInvoiceId && selectedGateway) {
      handlePayInvoice(pendingPayInvoiceId, selectedGateway);
    }
  };

  const handleWalletTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (isNaN(amount) || amount <= 0) return;
    setTopUpLoading(true);
    try {
      const providerToUse = enabledGateways.length === 1 ? enabledGateways[0].provider : selectedGateway || enabledGateways[0]?.provider;
      const res = await fetch(`${API_BASE}/v1/consumer/wallet/top-up`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ amount, provider: providerToUse }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Top-up failed');
      }
      const data = await res.json();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Top-up failed');
    } finally {
      setTopUpLoading(false);
    }
  };

  const parseLineItems = (items: string | InvoiceLineItem[]): InvoiceLineItem[] => {
    if (Array.isArray(items)) return items;
    if (typeof items === 'string') {
      try { return JSON.parse(items); } catch { return []; }
    }
    return [];
  };

  const handlePrintInvoice = (inv: Invoice) => {
    const items = parseLineItems(inv.lineItems);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const doc = printWindow.document;
    doc.open();

    // Build safe content
    const escHtml = (s: string) => {
      const div = doc.createElement('div');
      div.appendChild(doc.createTextNode(s));
      return div.innerHTML;
    };

    const lineItemRows = items.map(item =>
      `<tr><td>${escHtml(item.description)}</td><td style="text-align:center">${item.quantity.toLocaleString()}</td><td style="text-align:right">${escHtml(fmtCurrency(item.amount, inv.currency))}</td></tr>`
    ).join('');

    const invoiceHtml = [
      '<!DOCTYPE html><html><head><title>Invoice</title>',
      '<style>',
      '* { margin:0; padding:0; box-sizing:border-box; }',
      'body { font-family:"Segoe UI",Arial,sans-serif; color:#1e293b; padding:40px; max-width:800px; margin:0 auto; }',
      '.header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:40px; padding-bottom:20px; border-bottom:2px solid #e2e8f0; }',
      '.logo { font-size:22px; font-weight:700; color:#0f172a; }',
      '.logo span { color:#3b82f6; }',
      '.inv-title { text-align:right; }',
      '.inv-title h1 { font-size:28px; font-weight:700; color:#0f172a; margin-bottom:4px; }',
      '.inv-title .inv-id { font-size:13px; color:#64748b; }',
      '.meta { display:flex; justify-content:space-between; margin-bottom:32px; }',
      '.meta-block h3 { font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#94a3b8; margin-bottom:6px; }',
      '.meta-block p { font-size:14px; color:#334155; line-height:1.5; }',
      '.badge { display:inline-block; padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; }',
      '.badge-paid { background:#dcfce7; color:#16a34a; }',
      '.badge-draft { background:#f1f5f9; color:#64748b; }',
      '.badge-failed { background:#fee2e2; color:#dc2626; }',
      '.badge-overdue { background:#fef3c7; color:#d97706; }',
      'table { width:100%; border-collapse:collapse; margin-bottom:24px; }',
      'th { text-align:left; padding:10px 14px; font-size:11px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.05em; border-bottom:2px solid #e2e8f0; }',
      'td { padding:12px 14px; font-size:14px; color:#334155; border-bottom:1px solid #f1f5f9; }',
      '.total-row { border-top:2px solid #e2e8f0; }',
      '.total-row td { font-size:16px; font-weight:700; color:#0f172a; padding-top:16px; }',
      '.footer { margin-top:40px; padding-top:20px; border-top:1px solid #e2e8f0; font-size:12px; color:#94a3b8; text-align:center; }',
      '@media print { .no-print { display:none !important; } body { padding:20px; } }',
      '</style></head><body>',
      '<div class="header">',
      '  <div class="logo" style="display:flex;align-items:center;gap:12px">',
      '    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">',
      '      <defs><linearGradient id="g4" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="#1e3a5f"/><stop offset="100%" stop-color="#0f172a"/></linearGradient>',
      '      <linearGradient id="g4b" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#38bdf8"/><stop offset="100%" stop-color="#818cf8"/></linearGradient></defs>',
      '      <rect width="48" height="48" rx="12" fill="url(#g4)"/>',
      '      <polygon points="24,6 40,15 40,33 24,42 8,33 8,15" fill="none" stroke="url(#g4b)" stroke-width="1.5"/>',
      '      <polygon points="24,12 34,17.5 34,30.5 24,36 14,30.5 14,17.5" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>',
      '      <path d="M15 18l4 12 5-9 5 9 4-12" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
      '      <circle cx="24" cy="6" r="1.5" fill="#38bdf8"/><circle cx="40" cy="15" r="1.5" fill="#818cf8"/>',
      '      <circle cx="40" cy="33" r="1.5" fill="#818cf8"/><circle cx="24" cy="42" r="1.5" fill="#38bdf8"/>',
      '      <circle cx="8" cy="33" r="1.5" fill="#38bdf8"/><circle cx="8" cy="15" r="1.5" fill="#38bdf8"/>',
      '    </svg>',
      '    <div><div style="font-size:22px;font-weight:700;color:#0f172a">API <span style="color:#3b82f6">Gateway</span></div>',
      '    <div style="font-size:11px;color:#94a3b8;letter-spacing:0.05em">PLATFORM</div></div>',
      '  </div>',
      '  <div class="inv-title"><h1>INVOICE</h1>',
      '    <div class="inv-id">#', escHtml(inv.id.substring(0, 8).toUpperCase()), '</div>',
      '  </div>',
      '</div>',
      '<div class="meta">',
      '  <div class="meta-block"><h3>Billing Period</h3><p>', escHtml(fmtDate(inv.billingPeriodStart)), ' — ', escHtml(fmtDate(inv.billingPeriodEnd)), '</p></div>',
      '  <div class="meta-block"><h3>Issue Date</h3><p>', escHtml(fmtDate(inv.createdAt)), '</p></div>',
      '  <div class="meta-block"><h3>Status</h3><p><span class="badge badge-', inv.status.toLowerCase(), '">', escHtml(inv.status), '</span></p>',
      inv.paidAt ? '<p style="margin-top:4px;font-size:12px;color:#64748b">Paid on ' + escHtml(fmtDate(inv.paidAt)) + '</p>' : '',
      '  </div>',
      '  <div class="meta-block"><h3>Reference</h3><p>', escHtml(inv.paystackReference || 'N/A'), '</p></div>',
      '</div>',
      '<table><thead><tr><th>Description</th><th style="text-align:center">Quantity</th><th style="text-align:right">Amount</th></tr></thead>',
      '<tbody>', lineItemRows,
      '<tr class="total-row"><td colspan="2" style="text-align:right">Total</td><td style="text-align:right">', escHtml(fmtCurrency(inv.totalAmount, inv.currency)), '</td></tr>',
      '</tbody></table>',
      '<div style="margin-top:24px;padding:16px;background:#f8fafc;border-radius:8px;font-size:13px;color:#475569">',
      '  <strong>Invoice ID:</strong> ', escHtml(inv.id), '<br/>',
      '  <strong>Currency:</strong> ', escHtml(inv.currency),
      '</div>',
      '<div class="footer"><p>API Gateway Platform — This is a computer-generated invoice, no signature required.</p></div>',
      '<div class="no-print" style="text-align:center;margin-top:30px">',
      '  <button onclick="window.print()" style="padding:10px 28px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Print Invoice</button>',
      '</div>',
      '</body></html>'
    ].join('');

    doc.write(invoiceHtml);
    doc.close();
  };

  /* alert actions */
  const createAlert = async () => {
    const thresholdNum = parseFloat(alertForm.threshold);
    if (isNaN(thresholdNum)) {
      setAlertError('Threshold must be a valid number.');
      return;
    }
    setAlertSubmitting(true);
    setAlertError('');
    try {
      const res = await fetch(`${API_BASE}/v1/consumer/alerts`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          metric: alertForm.metric,
          condition: alertForm.condition,
          threshold: thresholdNum,
          enabled: true,
        }),
      });
      if (!res.ok) {
        setAlertError(`Failed to create alert (${res.status})`);
        return;
      }
      setAlertForm({ metric: ALERT_METRICS[0], condition: ALERT_CONDITIONS[0], threshold: '' });
      await loadAlerts();
    } catch (e) {
      setAlertError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setAlertSubmitting(false);
    }
  };

  const deleteAlert = async (id: string) => {
    setAlertActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/v1/consumer/alerts/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch { /* silent */ }
    finally { setAlertActionLoading(null); }
  };

  const toggleAlert = async (id: string, currentEnabled: boolean) => {
    setAlertActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/v1/consumer/alerts/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (res.ok) {
        setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, enabled: !currentEnabled } : a));
      }
    } catch { /* silent */ }
    finally { setAlertActionLoading(null); }
  };

  /* ---------- shared styles ---------- */
  const card: React.CSSProperties = {
    backgroundColor: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24, marginBottom: 24,
  };
  const sectionTitle: React.CSSProperties = { fontSize: 17, fontWeight: 600, color: '#1e293b', marginBottom: 16, marginTop: 0 };
  const thStyle: React.CSSProperties = {
    textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0',
  };
  const tdStyle: React.CSSProperties = {
    padding: '12px 14px', fontSize: 14, color: '#334155', borderBottom: '1px solid #f1f5f9',
  };
  const btnPrimary: React.CSSProperties = {
    padding: '8px 18px', backgroundColor: '#3b82f6', color: '#fff', border: 'none',
    borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  };
  const btnSecondary: React.CSSProperties = {
    padding: '6px 14px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0',
    borderRadius: 8, fontSize: 13, fontWeight: 500, color: '#475569', cursor: 'pointer',
  };
  const inputStyle: React.CSSProperties = {
    padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, width: '100%', boxSizing: 'border-box',
  };

  const errBox = (msg: string) => (
    <div style={{ padding: 14, backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
      {msg}
    </div>
  );

  const emptyState = (icon: string, title: string, subtitle: string) => (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: '#334155', marginBottom: 6 }}>{title}</h3>
      <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>{subtitle}</p>
    </div>
  );

  /* loading skeleton */
  if (loading) {
    return (
      <div style={{ maxWidth: 960 }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>Billing &amp; Usage</h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>Manage your plan, view usage, and billing history</p>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ ...card, height: 100, background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
        ))}
        <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      </div>
    );
  }

  /* chart helpers */
  const maxRequests = Math.max(...history.map((h) => h.requestCount), 1);

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>Billing &amp; Usage</h1>
          <span style={{
            padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
            backgroundColor: billingMode === 'PAY_AS_YOU_GO' ? '#dbeafe' : '#f0fdf4',
            color: billingMode === 'PAY_AS_YOU_GO' ? '#2563eb' : '#16a34a',
          }}>{billingMode === 'PAY_AS_YOU_GO' ? 'Pay As You Go' : 'Subscription'}</span>
        </div>
        <p style={{ fontSize: 14, color: '#64748b', margin: '4px 0 0' }}>
          {billingMode === 'PAY_AS_YOU_GO'
            ? 'Top up your wallet and pay per API request'
            : 'Manage your plan, view usage, and billing history'}
        </p>
      </div>

      {/* Payment verification banner */}
      {verifyMsg && (
        <div style={{
          padding: '14px 18px',
          marginBottom: 20,
          borderRadius: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: verifyMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
          border: `1px solid ${verifyMsg.type === 'success' ? '#86efac' : '#fecaca'}`,
          color: verifyMsg.type === 'success' ? '#166534' : '#991b1b',
          fontSize: 14,
          fontWeight: 500,
        }}>
          <span>{verifyMsg.text}</span>
          <button
            onClick={() => setVerifyMsg(null)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              color: 'inherit',
              padding: '0 4px',
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* =========== TAB NAVIGATION =========== */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, backgroundColor: '#f1f5f9', borderRadius: 10, padding: 4 }}>
        {[
          { key: 'overview', label: 'Overview' },
          ...(billingMode === 'SUBSCRIPTION' ? [{ key: 'invoices', label: 'Invoices' }] : []),
          ...(billingMode === 'PAY_AS_YOU_GO' ? [{ key: 'wallet', label: 'Wallet' }] : []),
          { key: 'settings', label: 'Settings' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSection(tab.key as typeof activeSection)}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: 8,
              border: 'none',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: activeSection === tab.key ? '#fff' : 'transparent',
              color: activeSection === tab.key ? '#0f172a' : '#64748b',
              boxShadow: activeSection === tab.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* =========== OVERVIEW TAB =========== */}
      {activeSection === 'overview' && (<>

      {/* =========== 1. USAGE OVERVIEW =========== */}
      {sectionErrors.summary && errBox(sectionErrors.summary)}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'API Calls This Month', value: summary ? summary.requestsThisMonth.toLocaleString() : '--', icon: '\u{1F4CA}' },
          { label: 'Avg Latency', value: summary ? `${Math.round(summary.averageLatencyMs)} ms` : '--', icon: '\u{26A1}' },
          { label: 'Error Rate', value: summary ? `${summary.errorRate.toFixed(2)}%` : '--', icon: summary && summary.errorRate > 5 ? '\u{26A0}\u{FE0F}' : '\u{2705}' },
          billingMode === 'PAY_AS_YOU_GO'
            ? { label: 'Wallet Balance', value: wallet ? fmtCurrency(wallet.balance, wallet.currency) : '--', icon: '\u{1F4B0}' }
            : { label: 'Estimated Cost', value: cost ? fmtCurrency(cost.estimatedCost, cost.currency) : '--', icon: '\u{1F4B5}' },
        ].map((stat) => (
          <div key={stat.label} style={{
            backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 20,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{stat.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', lineHeight: 1 }}>{stat.value}</div>
              </div>
              <div style={{ fontSize: 24 }}>{stat.icon}</div>
            </div>
          </div>
        ))}
      </div>

      {/* =========== 2. USAGE CHART =========== */}
      <div style={card}>
        <h2 style={sectionTitle}>Daily Usage (Last 30 Days)</h2>
        {sectionErrors.history && errBox(sectionErrors.history)}
        {history.length === 0 && !sectionErrors.history
          ? emptyState('\u{1F4C9}', 'No usage data yet', 'Usage history will appear once you start making API calls.')
          : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {history.map((entry) => {
                const successWidth = ((entry.requestCount - entry.errorCount) / maxRequests) * 100;
                const errorWidth = (entry.errorCount / maxRequests) * 100;
                return (
                  <div key={entry.date} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                    <div style={{ width: 80, fontSize: 12, color: '#64748b', flexShrink: 0, textAlign: 'right' }}>
                      {fmtDate(entry.date)}
                    </div>
                    <div style={{ flex: 1, display: 'flex', height: 18, borderRadius: 4, overflow: 'hidden', backgroundColor: '#f1f5f9' }}>
                      {successWidth > 0 && (
                        <div style={{ width: `${successWidth}%`, backgroundColor: '#3b82f6', transition: 'width 0.3s' }} />
                      )}
                      {errorWidth > 0 && (
                        <div style={{ width: `${errorWidth}%`, backgroundColor: '#ef4444', transition: 'width 0.3s' }} />
                      )}
                    </div>
                    <div style={{ width: 80, fontSize: 12, color: '#334155', flexShrink: 0 }}>
                      {entry.requestCount.toLocaleString()}
                      {entry.errorCount > 0 && (
                        <span style={{ color: '#ef4444', marginLeft: 4 }}>({entry.errorCount} err)</span>
                      )}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, backgroundColor: '#3b82f6', borderRadius: 2, marginRight: 4 }} />Successful</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, backgroundColor: '#ef4444', borderRadius: 2, marginRight: 4 }} />Errors</span>
              </div>
            </div>
          )}
      </div>

      {/* =========== 3. PER-API BREAKDOWN =========== */}
      <div style={card}>
        <h2 style={sectionTitle}>Per-API Breakdown</h2>
        {sectionErrors.apis && errBox(sectionErrors.apis)}
        {apiUsages.length === 0 && !sectionErrors.apis
          ? emptyState('\u{1F310}', 'No API usage yet', 'Per-API statistics will appear once you subscribe and start calling APIs.')
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>API Name</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Requests</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Avg Latency</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Error Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {apiUsages.map((api) => (
                    <tr key={api.apiId}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{api.apiName}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{api.totalRequests.toLocaleString()}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{Math.round(api.averageLatencyMs)} ms</td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: api.errorRate > 5 ? '#dc2626' : '#16a34a' }}>
                        {api.errorRate.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* =========== 4. CURRENT PLAN & COST =========== */}
      <div style={{ ...card, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)' }} />
        <h2 style={sectionTitle}>Current Plan &amp; Cost</h2>
        {sectionErrors.cost && errBox(sectionErrors.cost)}
        {cost ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Plan</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>{cost.planName}</div>
                <div style={{ display: 'flex', gap: 24, fontSize: 13 }}>
                  <div><span style={{ color: '#94a3b8' }}>Pricing: </span><span style={{ fontWeight: 600, color: '#0f172a' }}>{cost.pricingModel}</span></div>
                  <div><span style={{ color: '#94a3b8' }}>Included: </span><span style={{ fontWeight: 600, color: '#0f172a' }}>{cost.includedRequests.toLocaleString()} requests</span></div>
                  {cost.overageRequests > 0 && (
                    <div><span style={{ color: '#94a3b8' }}>Overage: </span><span style={{ fontWeight: 600, color: '#ef4444' }}>{cost.overageRequests.toLocaleString()} requests</span></div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Estimated Cost</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#0f172a' }}>{fmtCurrency(cost.estimatedCost, cost.currency)}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{fmtPeriod(cost.billingPeriodStart, cost.billingPeriodEnd)}</div>
              </div>
            </div>
            {/* progress bar: usage vs included */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                <span>{cost.totalRequests.toLocaleString()} used</span>
                <span>{cost.includedRequests.toLocaleString()} included</span>
              </div>
              <div style={{ height: 10, backgroundColor: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 6, transition: 'width 0.3s',
                  width: `${Math.min((cost.totalRequests / Math.max(cost.includedRequests, 1)) * 100, 100)}%`,
                  backgroundColor: cost.totalRequests > cost.includedRequests ? '#ef4444' : '#3b82f6',
                }} />
              </div>
              {cost.totalRequests > cost.includedRequests && (
                <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>
                  Over quota by {(cost.totalRequests - cost.includedRequests).toLocaleString()} requests
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <a href="/subscriptions" style={{
                padding: '8px 16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0',
                borderRadius: 8, fontSize: 13, fontWeight: 500, color: '#475569', textDecoration: 'none',
              }}>
                Change Plan
              </a>
            </div>
          </>
        ) : !sectionErrors.cost ? (
          emptyState('\u{1F4CB}', 'No plan information', 'Plan and cost details will appear once you are subscribed to a plan.')
        ) : null}
      </div>

      </>)}

      {/* =========== INVOICES TAB =========== */}
      {activeSection === 'invoices' && billingMode === 'SUBSCRIPTION' && (
      <>
      <div style={card}>
        <h2 style={sectionTitle}>Invoices</h2>
        {sectionErrors.invoices && errBox(sectionErrors.invoices)}
        {invoices.length === 0 && !sectionErrors.invoices
          ? emptyState('\u{1F4B3}', 'No invoices yet', 'Invoices will appear here when billing is active for your account.')
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Period</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Date</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const colors = statusColors[inv.status] || statusColors.DRAFT;
                    return (
                      <tr key={inv.id}>
                        <td style={tdStyle}>{fmtPeriod(inv.billingPeriodStart, inv.billingPeriodEnd)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(inv.totalAmount, inv.currency)}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', padding: '3px 10px', borderRadius: 999,
                            fontSize: 12, fontWeight: 600, backgroundColor: colors.bg, color: colors.fg,
                          }}>
                            {inv.status}
                          </span>
                          {inv.status === 'PAID' && inv.paidAt && (
                            <span style={{ marginLeft: 8, fontSize: 12, color: '#64748b' }}>
                              {fmtDate(inv.paidAt)}
                            </span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtDate(inv.createdAt)}</td>
                        <td style={{ ...tdStyle, textAlign: 'center', display: 'flex', gap: 8, justifyContent: 'center' }}>
                          {inv.status !== 'PAID' && inv.status !== 'REFUNDED' && (
                            <button
                              onClick={() => handlePayInvoice(inv.id)}
                              disabled={payingInvoiceId !== null}
                              style={{
                                padding: '6px 16px',
                                backgroundColor: payingInvoiceId === inv.id ? '#93c5fd' : '#3b82f6',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: payingInvoiceId !== null ? 'not-allowed' : 'pointer',
                                opacity: payingInvoiceId !== null && payingInvoiceId !== inv.id ? 0.5 : 1,
                              }}
                            >
                              {payingInvoiceId === inv.id ? 'Paying...' : 'Pay Now'}
                            </button>
                          )}
                          <button
                            onClick={() => handlePrintInvoice(inv)}
                            style={{
                              padding: '6px 14px',
                              backgroundColor: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              borderRadius: 8,
                              fontSize: 13,
                              fontWeight: 500,
                              color: '#475569',
                              cursor: 'pointer',
                            }}
                          >
                            Print
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      </>
      )}

      {/* =========== SETTINGS TAB =========== */}
      {activeSection === 'settings' && (<>

      {/* =========== 6. PAYMENT METHODS =========== */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ ...sectionTitle, marginBottom: 0 }}>Payment Methods</h2>
          <button style={btnPrimary} onClick={() => { setShowAddPm(true); setPmError(''); }}>
            + Add Payment Method
          </button>
        </div>
        {sectionErrors.payments && errBox(sectionErrors.payments)}

        {/* Add form */}
        {showAddPm && (
          <div style={{
            backgroundColor: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0',
            padding: 20, marginBottom: 20,
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', margin: '0 0 16px' }}>Add Payment Method</h3>
            {pmError && errBox(pmError)}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Type</label>
                <select
                  style={{ ...inputStyle, cursor: 'pointer' }}
                  value={pmForm.type}
                  onChange={(e) => setPmForm((p) => ({ ...p, type: e.target.value }))}
                >
                  <option value="CREDIT_CARD">Credit Card</option>
                  <option value="BANK_ACCOUNT">Bank Account</option>
                  <option value="PAYPAL">PayPal</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Provider</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. Visa, Stripe"
                  value={pmForm.provider}
                  onChange={(e) => setPmForm((p) => ({ ...p, provider: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Reference</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. **** **** **** 4242"
                  value={pmForm.providerRef}
                  onChange={(e) => setPmForm((p) => ({ ...p, providerRef: e.target.value }))}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowAddPm(false)} disabled={pmSubmitting}>Cancel</button>
              <button style={{ ...btnPrimary, opacity: pmSubmitting ? 0.6 : 1 }} onClick={addPaymentMethod} disabled={pmSubmitting}>
                {pmSubmitting ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        )}

        {/* List */}
        {paymentMethods.length === 0 && !sectionErrors.payments && !showAddPm
          ? emptyState('\u{1F4B3}', 'No payment methods', 'Add a payment method to enable automatic billing.')
          : (
            <div style={{ display: 'grid', gap: 12 }}>
              {paymentMethods.map((pm) => {
                const last4 = pm.providerRef.length >= 4 ? pm.providerRef.slice(-4) : pm.providerRef;
                const isActioning = actionLoading === pm.id;
                return (
                  <div key={pm.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 18px', backgroundColor: pm.isDefault ? '#f0f9ff' : '#fff',
                    borderRadius: 10, border: `1px solid ${pm.isDefault ? '#bae6fd' : '#e2e8f0'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <span style={{ fontSize: 28 }}>{paymentTypeIcons[pm.type] || '\u{1F4B3}'}</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                          {pm.provider} {'\u2022\u2022\u2022\u2022'} {last4}
                          {pm.isDefault && (
                            <span style={{
                              marginLeft: 8, padding: '2px 8px', backgroundColor: '#dbeafe', color: '#2563eb',
                              borderRadius: 999, fontSize: 11, fontWeight: 600,
                            }}>
                              Default
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>
                          {pm.type.replace('_', ' ')} &middot; Added {fmtDate(pm.createdAt)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!pm.isDefault && (
                        <button
                          style={{ ...btnSecondary, opacity: isActioning ? 0.5 : 1 }}
                          onClick={() => setDefault(pm.id)}
                          disabled={isActioning}
                        >
                          Set Default
                        </button>
                      )}
                      <button
                        style={{ ...btnSecondary, color: '#dc2626', opacity: isActioning ? 0.5 : 1 }}
                        onClick={() => removePaymentMethod(pm.id)}
                        disabled={isActioning}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      </>)}

      {/* =========== WALLET TAB =========== */}
      {activeSection === 'wallet' && billingMode === 'PAY_AS_YOU_GO' && (
      <>
      <div style={card}>
        <h2 style={sectionTitle}>Wallet</h2>
        {sectionErrors.wallet && errBox(sectionErrors.wallet)}
        {wallet ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div style={{ padding: 16, backgroundColor: '#f0fdf4', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Balance</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#16a34a' }}>{fmtCurrency(wallet.balance, wallet.currency)}</div>
              </div>
              <div style={{ padding: 16, backgroundColor: '#f8fafc', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Auto Top-Up</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: wallet.autoTopUpEnabled ? '#16a34a' : '#94a3b8' }}>
                  {wallet.autoTopUpEnabled ? `Enabled (below ${fmtCurrency(wallet.autoTopUpThreshold || 0, wallet.currency)})` : 'Disabled'}
                </div>
              </div>
              <div style={{ padding: 16, backgroundColor: '#f8fafc', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Low Balance Alert</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#475569' }}>
                  {wallet.lowBalanceThreshold ? fmtCurrency(wallet.lowBalanceThreshold, wallet.currency) : 'Not set'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
              <input
                type="number"
                placeholder="Amount to top up"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                style={{ ...inputStyle, width: 200 }}
              />
              <button
                onClick={handleWalletTopUp}
                disabled={topUpLoading || !topUpAmount}
                style={{ ...btnPrimary, opacity: topUpLoading || !topUpAmount ? 0.5 : 1 }}
              >
                {topUpLoading ? 'Processing...' : 'Top Up Wallet'}
              </button>
            </div>

            {/* Wallet Settings */}
            <div style={{ backgroundColor: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', padding: 20, marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 12 }}>Wallet Settings</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Auto Top-Up</label>
                  <select
                    value={wallet.autoTopUpEnabled ? 'true' : 'false'}
                    onChange={(e) => {
                      const enabled = e.target.value === 'true';
                      fetch(`${API_BASE}/v1/consumer/wallet/settings`, {
                        method: 'PUT', headers: authHeaders(),
                        body: JSON.stringify({ autoTopUpEnabled: enabled }),
                      }).then(res => res.ok && res.json()).then(w => w && setWallet(w));
                    }}
                    style={inputStyle}
                  >
                    <option value="false">Disabled</option>
                    <option value="true">Enabled</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Top-Up When Below</label>
                  <input
                    type="number"
                    placeholder="e.g. 1000"
                    defaultValue={wallet.autoTopUpThreshold || ''}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) {
                        fetch(`${API_BASE}/v1/consumer/wallet/settings`, {
                          method: 'PUT', headers: authHeaders(),
                          body: JSON.stringify({ autoTopUpThreshold: val }),
                        }).then(res => res.ok && res.json()).then(w => w && setWallet(w));
                      }
                    }}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Top-Up Amount</label>
                  <input
                    type="number"
                    placeholder="e.g. 5000"
                    defaultValue={wallet.autoTopUpAmount || ''}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) {
                        fetch(`${API_BASE}/v1/consumer/wallet/settings`, {
                          method: 'PUT', headers: authHeaders(),
                          body: JSON.stringify({ autoTopUpAmount: val }),
                        }).then(res => res.ok && res.json()).then(w => w && setWallet(w));
                      }
                    }}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Low Balance Alert</label>
                  <input
                    type="number"
                    placeholder="e.g. 500"
                    defaultValue={wallet.lowBalanceThreshold || ''}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) {
                        fetch(`${API_BASE}/v1/consumer/wallet/settings`, {
                          method: 'PUT', headers: authHeaders(),
                          body: JSON.stringify({ lowBalanceThreshold: val }),
                        }).then(res => res.ok && res.json()).then(w => w && setWallet(w));
                      }
                    }}
                    style={inputStyle}
                  />
                </div>
              </div>
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                Settings save automatically when you change them. Auto top-up charges your default payment method.
              </p>
            </div>

            {walletTxns.content && walletTxns.content.length > 0 && (
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 10 }}>Recent Transactions</h3>
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Type</th>
                        <th style={thStyle}>Description</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Balance</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {walletTxns.content.map((txn) => (
                        <tr key={txn.id}>
                          <td style={tdStyle}>
                            <span style={{
                              padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                              backgroundColor: txn.type === 'CREDIT' ? '#dcfce7' : '#fee2e2',
                              color: txn.type === 'CREDIT' ? '#16a34a' : '#dc2626',
                            }}>{txn.type}</span>
                          </td>
                          <td style={tdStyle}>{txn.description}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600,
                            color: txn.type === 'CREDIT' ? '#16a34a' : '#dc2626' }}>
                            {txn.type === 'CREDIT' ? '+' : '-'}{fmtCurrency(txn.amount, txn.currency)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtCurrency(txn.balanceAfter, txn.currency)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtDate(txn.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : emptyState('\u{1F4B0}', 'No wallet yet', 'Your wallet will be created when you first top up.')}
      </div>

      </>
      )}

      {/* =========== GATEWAY PICKER MODAL =========== */}
      {showGatewayPicker && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: '#fff', borderRadius: 16, padding: 28,
            width: 400, maxWidth: '90vw',
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: '#0f172a' }}>
              Choose Payment Method
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {enabledGateways.map((gw) => (
                <button
                  key={gw.provider}
                  onClick={() => setSelectedGateway(gw.provider)}
                  style={{
                    padding: '14px 18px', borderRadius: 10, border: '2px solid',
                    borderColor: selectedGateway === gw.provider ? '#3b82f6' : '#e2e8f0',
                    backgroundColor: selectedGateway === gw.provider ? '#eff6ff' : '#fff',
                    cursor: 'pointer', textAlign: 'left', fontSize: 15, fontWeight: 600,
                    color: '#334155',
                  }}
                >
                  {gw.displayName}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowGatewayPicker(false); setPendingPayInvoiceId(null); }}
                style={btnSecondary}
              >Cancel</button>
              <button
                onClick={confirmGatewayAndPay}
                disabled={!selectedGateway}
                style={{ ...btnPrimary, opacity: selectedGateway ? 1 : 0.5 }}
              >Pay with {enabledGateways.find(g => g.provider === selectedGateway)?.displayName || '...'}</button>
            </div>
          </div>
        </div>
      )}

      {/* =========== 8. USAGE ALERTS (only in settings tab) =========== */}
      {activeSection === 'settings' && (
      <div style={card}>
        <h2 style={sectionTitle}>Usage Alerts</h2>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: '-8px 0 20px' }}>Get notified when your usage exceeds thresholds</p>
        {sectionErrors.alerts && errBox(sectionErrors.alerts)}

        {/* Create Alert form */}
        <div style={{
          backgroundColor: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0',
          padding: 20, marginBottom: 20,
        }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', margin: '0 0 16px' }}>Create Alert</h3>
          {alertError && errBox(alertError)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Metric</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={alertForm.metric}
                onChange={(e) => setAlertForm((p) => ({ ...p, metric: e.target.value }))}
              >
                {ALERT_METRICS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Condition</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={alertForm.condition}
                onChange={(e) => setAlertForm((p) => ({ ...p, condition: e.target.value }))}
              >
                {ALERT_CONDITIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Threshold</label>
              <input
                style={inputStyle}
                type="number"
                placeholder="e.g. 80"
                value={alertForm.threshold}
                onChange={(e) => setAlertForm((p) => ({ ...p, threshold: e.target.value }))}
              />
            </div>
            <button
              style={{ ...btnPrimary, opacity: alertSubmitting ? 0.6 : 1, whiteSpace: 'nowrap' }}
              onClick={createAlert}
              disabled={alertSubmitting}
            >
              {alertSubmitting ? 'Creating...' : 'Create Alert'}
            </button>
          </div>
        </div>

        {/* Alert Rules list */}
        {alerts.length === 0 && !sectionErrors.alerts
          ? emptyState('\u{1F514}', 'No alert rules yet', 'Create an alert above to get notified when usage thresholds are exceeded.')
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Metric</th>
                    <th style={thStyle}>Condition</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Threshold</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Enabled</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert) => {
                    const isActioning = alertActionLoading === alert.id;
                    return (
                      <tr key={alert.id}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{alert.metric}</td>
                        <td style={tdStyle}>{alert.condition}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{alert.threshold}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <button
                            onClick={() => toggleAlert(alert.id, alert.enabled)}
                            disabled={isActioning}
                            style={{
                              position: 'relative',
                              display: 'inline-block',
                              width: 44,
                              height: 24,
                              borderRadius: 12,
                              border: 'none',
                              backgroundColor: alert.enabled ? '#3b82f6' : '#cbd5e1',
                              cursor: isActioning ? 'not-allowed' : 'pointer',
                              transition: 'background-color 0.2s',
                              opacity: isActioning ? 0.5 : 1,
                              padding: 0,
                            }}
                          >
                            <span style={{
                              position: 'absolute',
                              top: 2,
                              left: alert.enabled ? 22 : 2,
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              backgroundColor: '#fff',
                              transition: 'left 0.2s',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                            }} />
                          </button>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <button
                            style={{ ...btnSecondary, color: '#dc2626', opacity: isActioning ? 0.5 : 1 }}
                            onClick={() => deleteAlert(alert.id)}
                            disabled={isActioning}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
      )}
    </div>
  );
}

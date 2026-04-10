'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  API helpers                                                        */
/* ------------------------------------------------------------------ */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('admin_token') || localStorage.getItem('token') || '';
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t
    ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type PricingModel = 'FREE' | 'FLAT_RATE' | 'PAY_PER_USE' | 'TIERED' | 'FREEMIUM';
type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE';
type TabKey = 'plans' | 'invoices' | 'revenue' | 'wallets';

interface WalletData {
  id: string;
  consumerId: string;
  balance: number;
  currency: string;
  autoTopUpEnabled: boolean;
  autoTopUpThreshold: number;
  autoTopUpAmount: number;
  lowBalanceThreshold: number;
  createdAt: string;
  updatedAt: string;
}

interface PricingPlan {
  id: string;
  name: string;
  description?: string;
  pricingModel: PricingModel;
  priceAmount: number;
  currency: string;
  billingPeriod: string;
  includedRequests: number;
  overageRate: number;
  createdAt?: string;
  [key: string]: unknown;
}

interface Invoice {
  id: string;
  consumerId: string;
  period: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  createdAt: string;
  [key: string]: unknown;
}

interface RevenueData {
  totalRevenue: number;
  averagePerInvoice: number;
  paidInvoices: number;
  outstanding: number;
  currency: string;
  byPlan: { planName: string; planId: string; revenue: number; invoiceCount: number }[];
  byStatus: { status: string; count: number; total: number }[];
}

interface PlanFormState {
  name: string;
  description: string;
  pricingModel: PricingModel;
  priceAmount: string;
  currency: string;
  billingPeriod: string;
  includedRequests: string;
  overageRate: string;
}

const PRICING_MODELS: PricingModel[] = ['FREE', 'FLAT_RATE', 'PAY_PER_USE', 'TIERED', 'FREEMIUM'];

const emptyPlanForm: PlanFormState = {
  name: '',
  description: '',
  pricingModel: 'FLAT_RATE',
  priceAmount: '',
  currency: 'USD',
  billingPeriod: 'MONTHLY',
  includedRequests: '',
  overageRate: '',
};

const INVOICE_STATUS_CONFIG: Record<InvoiceStatus, { dot: string; badge: string; label: string }> = {
  DRAFT:  { dot: 'bg-slate-400',   badge: 'bg-slate-50 text-slate-600 ring-slate-500/20',    label: 'Draft' },
  SENT:   { dot: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 ring-blue-600/20',       label: 'Sent' },
  PAID:   { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', label: 'Paid' },
  OVERDUE:{ dot: 'bg-red-500',     badge: 'bg-red-50 text-red-700 ring-red-600/20',          label: 'Overdue' },
};

const MODEL_BADGE: Record<PricingModel, { bg: string; text: string }> = {
  FREE:        { bg: 'bg-slate-100',   text: 'text-slate-600' },
  FLAT_RATE:   { bg: 'bg-purple-100',  text: 'text-purple-700' },
  PAY_PER_USE: { bg: 'bg-blue-100',    text: 'text-blue-700' },
  TIERED:      { bg: 'bg-amber-100',   text: 'text-amber-700' },
  FREEMIUM:    { bg: 'bg-emerald-100', text: 'text-emerald-700' },
};

/* ------------------------------------------------------------------ */
/*  Reusable small components                                          */
/* ------------------------------------------------------------------ */

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="animate-pulse space-y-3 p-6">
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-4 rounded bg-slate-200" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, row) => (
        <div key={row} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, col) => (
            <div key={col} className="h-4 rounded bg-slate-100" style={{ width: `${60 + Math.random() * 40}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-50 text-purple-400 mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500 max-w-sm">{subtitle}</p>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className={`${color} rounded-xl p-5`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function MonetizationPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('plans');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  /* ============================================================== */
  /*  PRICING PLANS state                                            */
  /* ============================================================== */
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState('');
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planSaving, setPlanSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchPlans = useCallback(async () => {
    setPlansLoading(true);
    setPlansError('');
    try {
      const res = await fetch(`${API_URL}/v1/monetization/pricing-plans`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load pricing plans (${res.status})`);
      const data = await res.json();
      const list: PricingPlan[] = Array.isArray(data) ? data : data.content || [];
      setPlans(list);
    } catch (err) {
      setPlansError(err instanceof Error ? err.message : 'Failed to load pricing plans');
    } finally {
      setPlansLoading(false);
    }
  }, []);

  const handleSavePlan = useCallback(async () => {
    if (!planForm.name.trim()) { showToast('Plan name is required', 'error'); return; }
    setPlanSaving(true);
    try {
      const num = (v: string) => (v ? Number(v) : 0);
      const body = {
        name: planForm.name.trim(),
        description: planForm.description.trim() || undefined,
        pricingModel: planForm.pricingModel,
        priceAmount: num(planForm.priceAmount),
        currency: planForm.currency || 'USD',
        billingPeriod: planForm.billingPeriod,
        includedRequests: num(planForm.includedRequests),
        overageRate: num(planForm.overageRate),
      };
      const url = editingPlanId
        ? `${API_URL}/v1/monetization/pricing-plans/${editingPlanId}`
        : `${API_URL}/v1/monetization/pricing-plans`;
      const method = editingPlanId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.message || `Save failed (${res.status})`);
      }
      setPlanModalOpen(false);
      setPlanForm(emptyPlanForm);
      setEditingPlanId(null);
      showToast(editingPlanId ? 'Plan updated successfully' : 'Plan created successfully');
      fetchPlans();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save plan', 'error');
    } finally {
      setPlanSaving(false);
    }
  }, [planForm, editingPlanId, fetchPlans, showToast]);

  const handleDeletePlan = useCallback(async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`${API_URL}/v1/monetization/pricing-plans/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setDeleteConfirmId(null);
      showToast('Plan deleted successfully');
      fetchPlans();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete plan', 'error');
    } finally {
      setDeleting(false);
    }
  }, [fetchPlans, showToast]);

  const openEditPlan = useCallback((plan: PricingPlan) => {
    setPlanForm({
      name: plan.name,
      description: plan.description || '',
      pricingModel: plan.pricingModel,
      priceAmount: String(plan.priceAmount ?? ''),
      currency: plan.currency || 'USD',
      billingPeriod: plan.billingPeriod || 'MONTHLY',
      includedRequests: String(plan.includedRequests ?? ''),
      overageRate: String(plan.overageRate ?? ''),
    });
    setEditingPlanId(plan.id);
    setPlanModalOpen(true);
  }, []);

  const openCreatePlan = useCallback(() => {
    setPlanForm(emptyPlanForm);
    setEditingPlanId(null);
    setPlanModalOpen(true);
  }, []);

  /* ============================================================== */
  /*  INVOICES state                                                  */
  /* ============================================================== */
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [invoicesError, setInvoicesError] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'ALL' | InvoiceStatus>('ALL');
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generateForm, setGenerateForm] = useState({ consumerId: '', period: '' });
  const [generating, setGenerating] = useState(false);

  const fetchInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    setInvoicesError('');
    try {
      const res = await fetch(`${API_URL}/v1/monetization/invoices`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load invoices (${res.status})`);
      const data = await res.json();
      const list: Invoice[] = Array.isArray(data) ? data : data.content || [];
      setInvoices(list);
    } catch (err) {
      setInvoicesError(err instanceof Error ? err.message : 'Failed to load invoices');
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  const handleGenerateInvoices = useCallback(async () => {
    if (!generateForm.consumerId.trim() || !generateForm.period.trim()) {
      showToast('Consumer ID and period are required', 'error');
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`${API_URL}/v1/monetization/invoices/generate`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          consumerId: generateForm.consumerId.trim(),
          period: generateForm.period.trim(),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.message || `Generate failed (${res.status})`);
      }
      setGenerateModalOpen(false);
      setGenerateForm({ consumerId: '', period: '' });
      showToast('Invoices generated successfully');
      fetchInvoices();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate invoices', 'error');
    } finally {
      setGenerating(false);
    }
  }, [generateForm, fetchInvoices, showToast]);

  const filteredInvoices = useMemo(() => {
    if (invoiceStatusFilter === 'ALL') return invoices;
    return invoices.filter((inv) => inv.status === invoiceStatusFilter);
  }, [invoices, invoiceStatusFilter]);

  /* ============================================================== */
  /*  REVENUE state                                                   */
  /* ============================================================== */
  const [revenue, setRevenue] = useState<RevenueData | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [revenueError, setRevenueError] = useState('');
  const [revenuePeriod, setRevenuePeriod] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');

  const fetchRevenue = useCallback(async (period: string) => {
    setRevenueLoading(true);
    setRevenueError('');
    try {
      const res = await fetch(`${API_URL}/v1/monetization/revenue?period=${period}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load revenue data (${res.status})`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await res.json();

      // Transform backend response shape to frontend RevenueData
      const currency = raw.currency
        ?? Object.keys(raw.totalRevenueByCurrency ?? {})[0]
        ?? 'USD';
      const totalRevenue = raw.totalRevenue
        ?? Object.values(raw.totalRevenueByCurrency ?? {}).reduce((a: number, b: number) => a + b, 0) as number;
      const invoiceCount = raw.invoiceCount ?? 0;

      // byStatus: backend may return array of {status,count,total} or a map of status->amount
      let byStatus: RevenueData['byStatus'] = [];
      if (Array.isArray(raw.byStatus)) {
        byStatus = raw.byStatus;
      } else if (raw.revenueByStatus && typeof raw.revenueByStatus === 'object') {
        byStatus = Object.entries(raw.revenueByStatus).map(([status, total]) => ({
          status,
          count: 0,
          total: total as number,
        }));
      }

      const paidInvoices = raw.paidInvoices
        ?? byStatus.find(s => s.status === 'PAID')?.count
        ?? 0;
      const outstanding = raw.outstanding
        ?? byStatus.filter(s => s.status !== 'PAID' && s.status !== 'DRAFT').reduce((sum, s) => sum + s.total, 0);
      const averagePerInvoice = raw.averagePerInvoice
        ?? (invoiceCount > 0 ? totalRevenue / invoiceCount : 0);

      // byPlan: backend may return array of {planName,planId,revenue,invoiceCount} or a map of planName->revenue
      let byPlan: RevenueData['byPlan'] = [];
      if (Array.isArray(raw.byPlan)) {
        byPlan = raw.byPlan;
      } else if (raw.perPlanBreakdown && typeof raw.perPlanBreakdown === 'object') {
        byPlan = Object.entries(raw.perPlanBreakdown).map(([planName, revenue]) => ({
          planName,
          planId: planName,
          revenue: revenue as number,
          invoiceCount: 0,
        }));
      }

      setRevenue({ totalRevenue, averagePerInvoice, paidInvoices, outstanding, currency, byPlan, byStatus });
    } catch (err) {
      setRevenueError(err instanceof Error ? err.message : 'Failed to load revenue data');
    } finally {
      setRevenueLoading(false);
    }
  }, []);

  /* ============================================================== */
  /*  BILLING MODE state                                              */
  /* ============================================================== */
  // Platform billing mode
  const [billingMode, setBillingMode] = useState<'SUBSCRIPTION' | 'PAY_AS_YOU_GO'>('SUBSCRIPTION');
  const [billingModeLoading, setBillingModeLoading] = useState(false);

  /* ============================================================== */
  /*  WALLETS state                                                    */
  /* ============================================================== */
  const [wallets, setWallets] = useState<WalletData[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(true);
  const [walletsError, setWalletsError] = useState('');

  const fetchWallets = useCallback(async () => {
    setWalletsLoading(true);
    setWalletsError('');
    try {
      const res = await fetch(`${API_URL}/v1/monetization/wallets`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load wallets (${res.status})`);
      const data = await res.json();
      setWallets(Array.isArray(data) ? data : []);
    } catch (err) {
      setWalletsError(err instanceof Error ? err.message : 'Failed to load wallets');
    } finally {
      setWalletsLoading(false);
    }
  }, []);

  const fetchBillingMode = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/v1/platform-settings/billing-mode`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setBillingMode(data.billingMode || 'SUBSCRIPTION');
      }
    } catch { /* silent */ }
  }, []);

  const toggleBillingMode = async (mode: 'SUBSCRIPTION' | 'PAY_AS_YOU_GO') => {
    setBillingModeLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/platform-settings/billing-mode`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ billingMode: mode }),
      });
      if (res.ok) {
        setBillingMode(mode);
        showToast(`Billing mode switched to ${mode === 'SUBSCRIPTION' ? 'Subscription' : 'Pay As You Go'}`);
      } else {
        showToast('Failed to update billing mode', 'error');
      }
    } catch {
      showToast('Failed to update billing mode', 'error');
    } finally {
      setBillingModeLoading(false);
    }
  };

  /* ============================================================== */
  /*  Data loading on tab change                                      */
  /* ============================================================== */
  useEffect(() => {
    fetchBillingMode();
    if (activeTab === 'plans') fetchPlans();
    else if (activeTab === 'invoices') fetchInvoices();
    else if (activeTab === 'revenue') fetchRevenue(revenuePeriod);
    else if (activeTab === 'wallets') fetchWallets();
  }, [activeTab, fetchPlans, fetchInvoices, fetchRevenue, revenuePeriod, fetchWallets, fetchBillingMode]);

  /* ============================================================== */
  /*  Shared style classes                                            */
  /* ============================================================== */
  const inputCls =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30';
  const labelCls = 'block text-sm font-medium text-slate-700 mb-1.5';
  const selectCls =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30';

  /* ============================================================== */
  /*  Tab config                                                      */
  /* ============================================================== */
  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = useMemo(
    () => [
      {
        key: 'plans',
        label: 'Pricing Plans',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
        ),
      },
      {
        key: 'invoices',
        label: 'Invoices',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        ),
      },
      {
        key: 'revenue',
        label: 'Revenue',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        ),
      },
      {
        key: 'wallets',
        label: 'Wallets',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 6v3" />
          </svg>
        ),
      },
    ],
    [],
  );

  /* ============================================================== */
  /*  Format helpers                                                  */
  /* ============================================================== */
  const fmtCurrency = (amount: number, currency?: string) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount);
    } catch {
      return `${currency || 'USD'} ${amount.toFixed(2)}`;
    }
  };

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  };

  /* ============================================================== */
  /*  Render                                                          */
  /* ============================================================== */
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border max-w-sm transition-all ${
            toast.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {toast.type === 'error' ? (
            <svg className="w-5 h-5 shrink-0 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 shrink-0 text-emerald-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <p className="text-sm font-medium flex-1">{toast.message}</p>
          <button onClick={() => setToast(null)} className="shrink-0 opacity-50 hover:opacity-100">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Monetization</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage pricing plans, generate invoices, and track revenue across your API platform.
        </p>
      </div>

        {/* Billing Mode Toggle */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Platform Billing Mode</h3>
              <p className="text-xs text-slate-500 mt-0.5">Choose how developers are charged for API usage</p>
            </div>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              <button
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${billingMode === 'SUBSCRIPTION' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => toggleBillingMode('SUBSCRIPTION')}
                disabled={billingModeLoading}
              >
                Subscription
              </button>
              <button
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${billingMode === 'PAY_AS_YOU_GO' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => toggleBillingMode('PAY_AS_YOU_GO')}
                disabled={billingModeLoading}
              >
                Pay As You Go
              </button>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            {billingMode === 'SUBSCRIPTION' ? (
              <span><strong>Subscription mode:</strong> Developers pay fixed monthly/quarterly/annual invoices. Auto-charge with saved cards. Dunning for failed payments.</span>
            ) : (
              <span><strong>Pay As You Go mode:</strong> Developers top up a prepaid wallet. Usage is deducted automatically based on per-request rates. API access blocked when wallet is empty.</span>
            )}
          </div>
        </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-purple-600 text-purple-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ============================================================ */}
      {/*  PRICING PLANS TAB                                            */}
      {/* ============================================================ */}
      {activeTab === 'plans' && (
        <>
          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">{plans.length} plan{plans.length !== 1 ? 's' : ''}</p>
            <button
              onClick={openCreatePlan}
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Create Plan
            </button>
          </div>

          {/* Error */}
          {plansError && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              {plansError}
            </div>
          )}

          {/* Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {plansLoading ? (
              <TableSkeleton cols={7} />
            ) : plans.length === 0 && !plansError ? (
              <EmptyState
                icon={
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                  </svg>
                }
                title="No pricing plans yet"
                subtitle="Create your first pricing plan to start monetizing your APIs."
              />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-100">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Model</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Price</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Billing</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Included Req.</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Overage</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plans.map((plan) => {
                    const mc = MODEL_BADGE[plan.pricingModel] || MODEL_BADGE.FLAT_RATE;
                    return (
                      <tr key={plan.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-medium text-slate-800">{plan.name}</p>
                          {plan.description && (
                            <p className="text-xs text-slate-400 truncate max-w-[200px]">{plan.description}</p>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${mc.bg} ${mc.text}`}>
                            {plan.pricingModel.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm tabular-nums text-slate-700">
                          {fmtCurrency(plan.priceAmount, plan.currency)}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-600">{plan.billingPeriod}</td>
                        <td className="px-5 py-3.5 text-sm tabular-nums text-slate-600">
                          {plan.includedRequests?.toLocaleString() ?? <span className="text-slate-300">&mdash;</span>}
                        </td>
                        <td className="px-5 py-3.5 text-sm tabular-nums text-slate-600">
                          {plan.overageRate ? fmtCurrency(plan.overageRate, plan.currency) : <span className="text-slate-300">&mdash;</span>}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openEditPlan(plan)}
                              className="px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-md transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(plan.id)}
                              className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Create / Edit Plan Modal */}
          {planModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="fixed inset-0 bg-black/40" onClick={() => { setPlanModalOpen(false); setEditingPlanId(null); }} />
              <div className="relative z-10 w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 mx-4 max-h-[90vh] overflow-y-auto">
                <div className="px-6 py-5 border-b border-slate-100">
                  <h2 className="text-lg font-bold text-slate-900">
                    {editingPlanId ? 'Edit Pricing Plan' : 'Create Pricing Plan'}
                  </h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {editingPlanId ? 'Update the plan details below.' : 'Define a new pricing plan for your API consumers.'}
                  </p>
                </div>
                <div className="px-6 py-5 space-y-5">
                  {/* Name */}
                  <div>
                    <label className={labelCls}>Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={planForm.name}
                      onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))}
                      className={inputCls}
                      placeholder="e.g. Pro Plan"
                    />
                  </div>
                  {/* Description */}
                  <div>
                    <label className={labelCls}>Description</label>
                    <textarea
                      value={planForm.description}
                      onChange={(e) => setPlanForm((f) => ({ ...f, description: e.target.value }))}
                      rows={2}
                      className={inputCls}
                      placeholder="Optional description..."
                    />
                  </div>
                  {/* Pricing Model */}
                  <div>
                    <label className={labelCls}>Pricing Model</label>
                    <select
                      value={planForm.pricingModel}
                      onChange={(e) => setPlanForm((f) => ({ ...f, pricingModel: e.target.value as PricingModel }))}
                      className={selectCls}
                    >
                      {PRICING_MODELS.map((m) => (
                        <option key={m} value={m}>
                          {m.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Price + Currency */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Price Amount</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={planForm.priceAmount}
                        onChange={(e) => setPlanForm((f) => ({ ...f, priceAmount: e.target.value }))}
                        className={inputCls}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Currency</label>
                      <select
                        value={planForm.currency}
                        onChange={(e) => setPlanForm((f) => ({ ...f, currency: e.target.value }))}
                        className={selectCls}
                      >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="GBP">GBP</option>
                        <option value="JPY">JPY</option>
                        <option value="CAD">CAD</option>
                        <option value="AUD">AUD</option>
                      </select>
                    </div>
                  </div>
                  {/* Billing Period */}
                  <div>
                    <label className={labelCls}>Billing Period</label>
                    <select
                      value={planForm.billingPeriod}
                      onChange={(e) => setPlanForm((f) => ({ ...f, billingPeriod: e.target.value }))}
                      className={selectCls}
                    >
                      <option value="MONTHLY">Monthly</option>
                      <option value="QUARTERLY">Quarterly</option>
                      <option value="YEARLY">Yearly</option>
                    </select>
                  </div>
                  {/* Included Requests + Overage */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Included Requests</label>
                      <input
                        type="number"
                        min={0}
                        value={planForm.includedRequests}
                        onChange={(e) => setPlanForm((f) => ({ ...f, includedRequests: e.target.value }))}
                        className={inputCls}
                        placeholder="e.g. 100000"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Overage Rate</label>
                      <input
                        type="number"
                        min={0}
                        step="0.0001"
                        value={planForm.overageRate}
                        onChange={(e) => setPlanForm((f) => ({ ...f, overageRate: e.target.value }))}
                        className={inputCls}
                        placeholder="e.g. 0.001"
                      />
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
                  <button
                    onClick={() => { setPlanModalOpen(false); setEditingPlanId(null); }}
                    className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSavePlan}
                    disabled={planSaving}
                    className="px-4 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm disabled:opacity-50 transition-colors"
                  >
                    {planSaving ? 'Saving...' : editingPlanId ? 'Update Plan' : 'Create Plan'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delete Confirmation Modal */}
          {deleteConfirmId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="fixed inset-0 bg-black/40" onClick={() => setDeleteConfirmId(null)} />
              <div className="relative z-10 w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 mx-4">
                <div className="px-6 py-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                      <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Delete Plan</h3>
                      <p className="text-sm text-slate-500">This action cannot be undone.</p>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600 mb-5">
                    Are you sure you want to delete the plan{' '}
                    <span className="font-semibold text-slate-800">
                      {plans.find((p) => p.id === deleteConfirmId)?.name || deleteConfirmId}
                    </span>
                    ? Any consumers on this plan may be affected.
                  </p>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDeletePlan(deleteConfirmId)}
                      disabled={deleting}
                      className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm disabled:opacity-50 transition-colors"
                    >
                      {deleting ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ============================================================ */}
      {/*  INVOICES TAB                                                  */}
      {/* ============================================================ */}
      {activeTab === 'invoices' && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
            <select
              value={invoiceStatusFilter}
              onChange={(e) => setInvoiceStatusFilter(e.target.value as 'ALL' | InvoiceStatus)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="SENT">Sent</option>
              <option value="PAID">Paid</option>
              <option value="OVERDUE">Overdue</option>
            </select>
            {invoiceStatusFilter !== 'ALL' && (
              <button
                onClick={() => setInvoiceStatusFilter('ALL')}
                className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear
              </button>
            )}
            <span className="text-xs text-slate-400">{filteredInvoices.length} result{filteredInvoices.length !== 1 ? 's' : ''}</span>
            <div className="ml-auto">
              <button
                onClick={() => setGenerateModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Generate Invoices
              </button>
            </div>
          </div>

          {/* Error */}
          {invoicesError && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              {invoicesError}
            </div>
          )}

          {/* Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {invoicesLoading ? (
              <TableSkeleton cols={6} />
            ) : filteredInvoices.length === 0 && !invoicesError ? (
              <EmptyState
                icon={
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                }
                title="No invoices found"
                subtitle={invoiceStatusFilter !== 'ALL' ? 'Try adjusting your status filter.' : 'Generate invoices for your API consumers to get started.'}
              />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-100">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Consumer ID</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Period</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Currency</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.map((inv) => {
                    const cfg = INVOICE_STATUS_CONFIG[inv.status] || INVOICE_STATUS_CONFIG.DRAFT;
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center text-xs font-bold shrink-0">
                              {inv.consumerId.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-sm font-mono text-slate-700 truncate max-w-[160px]">{inv.consumerId}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-700">{inv.period}</td>
                        <td className="px-5 py-3.5 text-sm font-medium tabular-nums text-slate-800">
                          {fmtCurrency(inv.amount, inv.currency)}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-600">{inv.currency}</td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${cfg.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="text-sm text-slate-500 tabular-nums">{fmtDate(inv.createdAt)}</p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Generate Invoices Modal */}
          {generateModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="fixed inset-0 bg-black/40" onClick={() => setGenerateModalOpen(false)} />
              <div className="relative z-10 w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 mx-4">
                <div className="px-6 py-5 border-b border-slate-100">
                  <h2 className="text-lg font-bold text-slate-900">Generate Invoices</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Generate invoices for a consumer over a billing period.</p>
                </div>
                <div className="px-6 py-5 space-y-5">
                  <div>
                    <label className={labelCls}>Consumer ID <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={generateForm.consumerId}
                      onChange={(e) => setGenerateForm((f) => ({ ...f, consumerId: e.target.value }))}
                      className={inputCls}
                      placeholder="e.g. consumer-abc-123"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Billing Period <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={generateForm.period}
                      onChange={(e) => setGenerateForm((f) => ({ ...f, period: e.target.value }))}
                      className={inputCls}
                      placeholder="e.g. 2026-03"
                    />
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
                  <button
                    onClick={() => setGenerateModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerateInvoices}
                    disabled={generating}
                    className="px-4 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm disabled:opacity-50 transition-colors"
                  >
                    {generating ? 'Generating...' : 'Generate'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ============================================================ */}
      {/*  REVENUE TAB                                                   */}
      {/* ============================================================ */}
      {activeTab === 'revenue' && (
        <>
          {/* Period selector */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-600">Period:</span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              {(['monthly', 'quarterly', 'yearly'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setRevenuePeriod(p)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    revenuePeriod === p
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {revenueError && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              {revenueError}
            </div>
          )}

          {revenueLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse bg-white border border-slate-200 rounded-xl p-5">
                  <div className="h-3 w-24 bg-slate-200 rounded mb-3" />
                  <div className="h-7 w-32 bg-slate-100 rounded" />
                </div>
              ))}
            </div>
          ) : revenue ? (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  label="Total Revenue"
                  value={fmtCurrency(revenue.totalRevenue, revenue.currency)}
                  color="bg-purple-50 text-purple-800"
                />
                <StatCard
                  label="Avg per Invoice"
                  value={fmtCurrency(revenue.averagePerInvoice, revenue.currency)}
                  color="bg-blue-50 text-blue-800"
                />
                <StatCard
                  label="Paid Invoices"
                  value={revenue.paidInvoices.toLocaleString()}
                  color="bg-emerald-50 text-emerald-800"
                />
                <StatCard
                  label="Outstanding"
                  value={fmtCurrency(revenue.outstanding, revenue.currency)}
                  color="bg-amber-50 text-amber-800"
                />
              </div>

              {/* Revenue by Plan */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-800">Revenue by Plan</h3>
                </div>
                {revenue.byPlan && revenue.byPlan.length > 0 ? (
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-slate-100">
                        <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Plan</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Revenue</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Invoices</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {revenue.byPlan.map((row) => {
                        const share = revenue.totalRevenue > 0 ? ((row.revenue / revenue.totalRevenue) * 100) : 0;
                        return (
                          <tr key={row.planId} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-5 py-3.5 text-sm font-medium text-slate-800">{row.planName}</td>
                            <td className="px-5 py-3.5 text-sm tabular-nums text-slate-700">{fmtCurrency(row.revenue, revenue.currency)}</td>
                            <td className="px-5 py-3.5 text-sm tabular-nums text-slate-600">{row.invoiceCount.toLocaleString()}</td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden max-w-[120px]">
                                  <div
                                    className="h-full bg-purple-500 rounded-full"
                                    style={{ width: `${Math.min(share, 100)}%` }}
                                  />
                                </div>
                                <span className="text-xs tabular-nums text-slate-500">{share.toFixed(1)}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-12 text-center text-sm text-slate-400">No plan-level data available.</div>
                )}
              </div>

              {/* Revenue by Status */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-800">Revenue by Invoice Status</h3>
                </div>
                {revenue.byStatus && revenue.byStatus.length > 0 ? (
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-slate-100">
                        <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Count</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {revenue.byStatus.map((row) => {
                        const statusKey = row.status as InvoiceStatus;
                        const cfg = INVOICE_STATUS_CONFIG[statusKey] || INVOICE_STATUS_CONFIG.DRAFT;
                        return (
                          <tr key={row.status} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-5 py-3.5">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${cfg.badge}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                                {cfg.label}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-sm tabular-nums text-slate-700">{row.count.toLocaleString()}</td>
                            <td className="px-5 py-3.5 text-sm tabular-nums font-medium text-slate-800">{fmtCurrency(row.total, revenue.currency)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-12 text-center text-sm text-slate-400">No status-level data available.</div>
                )}
              </div>
            </>
          ) : !revenueError ? (
            <EmptyState
              icon={
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              }
              title="No revenue data"
              subtitle="Revenue data will appear once invoices have been generated and processed."
            />
          ) : null}
        </>
      )}

      {/* ============================================================== */}
      {/* WALLETS TAB                                                    */}
      {/* ============================================================== */}
      {activeTab === 'wallets' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Developer Wallets</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {billingMode === 'PAY_AS_YOU_GO'
                  ? 'Wallets are active — developers top up and usage is deducted automatically'
                  : 'Wallets are inactive in Subscription mode. Switch to Pay As You Go to enable.'}
              </p>
            </div>
          </div>

          {walletsError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">{walletsError}</div>
          )}

          {walletsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />)}
            </div>
          ) : wallets.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">{'\u{1F4B0}'}</div>
              <h3 className="text-sm font-semibold text-slate-800">No wallets yet</h3>
              <p className="text-xs text-slate-500 mt-1">Developer wallets appear here when they top up for the first time.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">{wallets.length} wallet{wallets.length !== 1 ? 's' : ''}</span>
                <span className="text-xs font-medium text-slate-500">
                  Total balance: {fmtCurrency(wallets.reduce((sum, w) => sum + w.balance, 0), wallets[0]?.currency || 'NGN')}
                </span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-100">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Consumer</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Balance</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Auto Top-Up</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Threshold</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Top-Up Amt</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Low Alert</th>
                  </tr>
                </thead>
                <tbody>
                  {wallets.map(w => (
                    <tr key={w.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-sm font-mono text-slate-600">{w.consumerId.substring(0, 8)}...</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-slate-900">{fmtCurrency(w.balance, w.currency)}</td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${w.autoTopUpEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {w.autoTopUpEnabled ? 'On' : 'Off'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-slate-600">{w.autoTopUpThreshold ? fmtCurrency(w.autoTopUpThreshold, w.currency) : '-'}</td>
                      <td className="px-4 py-3 text-sm text-right text-slate-600">{w.autoTopUpAmount ? fmtCurrency(w.autoTopUpAmount, w.currency) : '-'}</td>
                      <td className="px-4 py-3 text-sm text-right text-slate-600">{w.lowBalanceThreshold ? fmtCurrency(w.lowBalanceThreshold, w.currency) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

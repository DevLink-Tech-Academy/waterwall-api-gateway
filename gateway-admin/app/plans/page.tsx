'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { DataTable, StatusBadge, FormModal, get, post, put } from '@gateway/shared-ui';
import type { Column, Pagination } from '@gateway/shared-ui';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Plan {
  id: string;
  name: string;
  description?: string;
  enforcement: string;
  requestsPerSecond?: number;
  requestsPerMinute?: number;
  requestsPerDay?: number;
  burstAllowance?: number;
  maxRequestsPerMonth?: number;
  status: string;
  createdAt: string;
  [key: string]: unknown;
}

interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

interface PlanFormState {
  name: string;
  description: string;
  requestsPerSecond: string;
  requestsPerMinute: string;
  requestsPerDay: string;
  burstAllowance: string;
  maxRequestsPerMonth: string;
  enforcement: string;
}

const emptyForm: PlanFormState = {
  name: '',
  description: '',
  requestsPerSecond: '',
  requestsPerMinute: '',
  requestsPerDay: '',
  burstAllowance: '',
  maxRequestsPerMonth: '',
  enforcement: 'SOFT',
};

/* ------------------------------------------------------------------ */
/*  Skeleton loader                                                    */
/* ------------------------------------------------------------------ */

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-6">
      {/* header row */}
      <div className="grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-4 rounded bg-gray-200" />
        ))}
      </div>
      {/* body rows */}
      {Array.from({ length: 6 }).map((_, row) => (
        <div key={row} className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, col) => (
            <div
              key={col}
              className="h-4 rounded bg-gray-100"
              style={{ width: `${60 + Math.random() * 40}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      {/* icon */}
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-400 mb-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-7 w-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-gray-900">No plans yet</h3>
      <p className="mt-1 text-sm text-gray-500 max-w-sm">
        Create your first plan to define rate limits and quotas for API consumers.
      </p>
      <button
        onClick={onCreateClick}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Create Plan
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  /* Modal state */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState<PlanFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  /* ---- Fetch plans ---- */
  const fetchPlans = useCallback(() => {
    setLoading(true);
    setError(null);
    get<PageResponse<Plan> | Plan[]>(`/v1/plans?page=${page - 1}&size=${pageSize}`)
      .then((res) => {
        if (Array.isArray(res)) {
          setPlans(res);
          setTotal(res.length);
        } else {
          setPlans(res.content ?? []);
          setTotal(res.totalElements ?? 0);
        }
      })
      .catch((err) => setError(err.message ?? 'Failed to load plans'))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  /* ---- Create / Update plan ---- */
  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const num = (v: string) => (v ? Number(v) : undefined);
      const rateLimits: Record<string, number | undefined> = {};
      if (form.requestsPerSecond) rateLimits.requestsPerSecond = num(form.requestsPerSecond);
      if (form.requestsPerMinute) rateLimits.requestsPerMinute = num(form.requestsPerMinute);
      if (form.requestsPerDay) rateLimits.requestsPerDay = num(form.requestsPerDay);
      if (form.burstAllowance) rateLimits.burstAllowance = num(form.burstAllowance);
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        rateLimits: Object.keys(rateLimits).length > 0 ? rateLimits : undefined,
        quota: form.maxRequestsPerMonth ? { maxRequestsPerMonth: num(form.maxRequestsPerMonth) } : undefined,
        enforcement: form.enforcement,
      };
      if (editingPlan) {
        await put(`/v1/plans/${editingPlan.id}`, payload);
        showToast('Plan updated successfully');
      } else {
        await post('/v1/plans', payload);
        showToast('Plan created successfully');
      }
      setModalOpen(false);
      setForm(emptyForm);
      setEditingPlan(null);
      fetchPlans();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save plan';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }, [form, editingPlan, fetchPlans]);

  /* ---- Open edit modal ---- */
  const openEdit = useCallback((plan: Plan) => {
    setEditingPlan(plan);
    setForm({
      name: plan.name,
      description: plan.description ?? '',
      requestsPerSecond: plan.requestsPerSecond?.toString() ?? '',
      requestsPerMinute: plan.requestsPerMinute?.toString() ?? '',
      requestsPerDay: plan.requestsPerDay?.toString() ?? '',
      burstAllowance: plan.burstAllowance?.toString() ?? '',
      maxRequestsPerMonth: plan.maxRequestsPerMonth?.toString() ?? '',
      enforcement: plan.enforcement ?? 'SOFT',
    });
    setModalOpen(true);
  }, []);

  /* ---- Columns ---- */
  const columns: Column<Plan>[] = useMemo(() => [
    {
      key: 'name',
      label: 'Name',
      sortable: true,
      render: (p) => (
        <span className="font-medium text-gray-900">{p.name}</span>
      ),
    },
    {
      key: 'enforcement',
      label: 'Enforcement',
      render: (p) => (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${
            p.enforcement === 'STRICT'
              ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20'
              : 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20'
          }`}
        >
          {p.enforcement}
        </span>
      ),
    },
    {
      key: 'requestsPerMinute',
      label: 'Req/min',
      render: (p) => (
        <span className="tabular-nums text-gray-600">
          {p.requestsPerMinute?.toLocaleString() ?? <span className="text-gray-300">&mdash;</span>}
        </span>
      ),
    },
    {
      key: 'requestsPerDay',
      label: 'Req/day',
      render: (p) => (
        <span className="tabular-nums text-gray-600">
          {p.requestsPerDay?.toLocaleString() ?? <span className="text-gray-300">&mdash;</span>}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (p) => <StatusBadge status={p.status} size="sm" />,
    },
    {
      key: 'actions' as keyof Plan,
      label: '',
      render: (p) => (
        <button
          onClick={(e) => { e.stopPropagation(); openEdit(p); }}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          Edit
        </button>
      ),
    },
  ], [openEdit]);

  const pagination: Pagination = {
    page,
    size: pageSize,
    total,
    onPageChange: setPage,
  };

  const set = (key: keyof PlanFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const openModal = () => { setEditingPlan(null); setForm(emptyForm); setModalOpen(true); };

  const inputCls =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30';

  const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5';

  const rateLabelCls = 'block text-xs font-medium text-gray-500 mb-1';

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {toast && (<div className={`fixed top-4 right-4 z-50 flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border max-w-sm ${toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{toast.type === 'error' ? (<svg className="w-5 h-5 shrink-0 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>) : (<svg className="w-5 h-5 shrink-0 text-emerald-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>)}<p className="text-sm font-medium flex-1">{toast.message}</p><button onClick={() => setToast(null)} className="shrink-0 opacity-50 hover:opacity-100"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button></div>)}
      {/* ---- Header ---- */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Plan Management
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Define rate limits, quotas, and enforcement policies for your API consumers.
          </p>
        </div>
        <button
          onClick={openModal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Create Plan
        </button>
      </div>

      {/* ---- Error banner ---- */}
      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* ---- Table card ---- */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
        {loading ? (
          <TableSkeleton />
        ) : plans.length === 0 && !error ? (
          <EmptyState onCreateClick={openModal} />
        ) : (
          <DataTable data={plans} columns={columns} pagination={pagination} loading={loading} />
        )}
      </div>

      {/* ---- Create Plan Modal ---- */}
      <FormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingPlan(null); }}
        title={editingPlan ? 'Edit Plan' : 'Create Plan'}
        onSubmit={handleSave}
        submitLabel={editingPlan ? 'Update' : 'Create'}
        loading={saving}
      >
        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className={labelCls}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={set('name')}
              className={inputCls}
              placeholder="e.g. Gold Plan"
            />
          </div>

          {/* Description */}
          <div>
            <label className={labelCls}>Description</label>
            <textarea
              value={form.description}
              onChange={set('description')}
              rows={2}
              className={inputCls}
              placeholder="Optional description for this plan..."
            />
          </div>

          {/* Rate Limits */}
          <fieldset className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
            <legend className="rounded-md bg-white px-2 py-0.5 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200">
              Rate Limits
            </legend>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={rateLabelCls}>Requests / sec</label>
                <input
                  type="number"
                  min={0}
                  value={form.requestsPerSecond}
                  onChange={set('requestsPerSecond')}
                  className={inputCls}
                  placeholder="0"
                />
              </div>
              <div>
                <label className={rateLabelCls}>Requests / min</label>
                <input
                  type="number"
                  min={0}
                  value={form.requestsPerMinute}
                  onChange={set('requestsPerMinute')}
                  className={inputCls}
                  placeholder="0"
                />
              </div>
              <div>
                <label className={rateLabelCls}>Requests / day</label>
                <input
                  type="number"
                  min={0}
                  value={form.requestsPerDay}
                  onChange={set('requestsPerDay')}
                  className={inputCls}
                  placeholder="0"
                />
              </div>
              <div>
                <label className={rateLabelCls}>Burst Allowance</label>
                <input
                  type="number"
                  min={0}
                  value={form.burstAllowance}
                  onChange={set('burstAllowance')}
                  className={inputCls}
                  placeholder="0"
                />
              </div>
            </div>
          </fieldset>

          {/* Monthly Quota */}
          <div>
            <label className={labelCls}>Quota: Max Requests / Month</label>
            <input
              type="number"
              min={0}
              value={form.maxRequestsPerMonth}
              onChange={set('maxRequestsPerMonth')}
              className={inputCls}
              placeholder="e.g. 1000000"
            />
          </div>

          {/* Enforcement */}
          <div>
            <label className={labelCls}>Enforcement</label>
            <div className="mt-1.5 flex items-center gap-4">
              {(['SOFT', 'STRICT'] as const).map((v) => (
                <label
                  key={v}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium transition ${
                    form.enforcement === v
                      ? v === 'STRICT'
                        ? 'border-red-300 bg-red-50 text-red-700 ring-2 ring-red-500/30'
                        : 'border-amber-300 bg-amber-50 text-amber-700 ring-2 ring-amber-500/30'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="enforcement"
                    value={v}
                    checked={form.enforcement === v}
                    onChange={() => setForm((f) => ({ ...f, enforcement: v }))}
                    className="sr-only"
                  />
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      v === 'STRICT' ? 'bg-red-500' : 'bg-amber-500'
                    }`}
                  />
                  {v}
                </label>
              ))}
            </div>
          </div>
        </div>
      </FormModal>
    </main>
  );
}

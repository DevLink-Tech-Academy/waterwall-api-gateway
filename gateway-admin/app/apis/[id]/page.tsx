'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { DataTable, StatusBadge, FormModal, get, post, put, del } from '@gateway/shared-ui';
import type { Column } from '@gateway/shared-ui';
import TransformationBuilder from '../../components/TransformationBuilder';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ApiDetail {
  id: string;
  name: string;
  version: string;
  status: string;
  description?: string;
  protocol?: string;
  protocolType?: string;
  visibility?: string;
  category?: string;
  tags?: string[];
  backendBaseUrl?: string;
  sensitivity?: string;
  versionStatus?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface Route {
  id: string;
  path: string;
  method: string;
  upstreamUrl: string;
  authTypes?: string[];
  enabled: boolean;
  [key: string]: unknown;
}

interface SubscriptionItem {
  id: string;
  applicationId: string;
  apiId: string;
  planId: string;
  planName?: string;
  status: string;
  reason?: string;
  reviewedAt?: string;
  createdAt: string;
  [key: string]: unknown;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const AUTH_TYPES = ['API_KEY', 'JWT', 'OAUTH2', 'BASIC', 'NONE'] as const;

type Tab = 'overview' | 'routes' | 'subscriptions' | 'deployments' | 'auth-policy' | 'policies' | 'gateway-config';

interface AuthPolicy {
  authMode: 'ANY' | 'ALL';
  allowAnonymous: boolean;
  enabledAuthTypes?: string[];
}

const AUTH_TYPE_INFO: Record<string, { label: string; desc: string; icon: React.ReactNode }> = {
  API_KEY: {
    label: 'API Key',
    desc: 'Authenticate via X-API-Key header or query parameter',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>,
  },
  JWT: {
    label: 'JWT Bearer Token',
    desc: 'Validate JWT tokens in Authorization: Bearer header',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>,
  },
  OAUTH2: {
    label: 'OAuth 2.0',
    desc: 'Validate OAuth 2.0 access tokens with introspection',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>,
  },
  BASIC: {
    label: 'Basic Auth',
    desc: 'HTTP Basic authentication with username and password',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>,
  },
  NONE: {
    label: 'No Authentication',
    desc: 'Allow unauthenticated public access to this API',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>,
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function methodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: 'bg-green-100 text-green-700',
    POST: 'bg-blue-100 text-blue-700',
    PUT: 'bg-amber-100 text-amber-700',
    PATCH: 'bg-orange-100 text-orange-700',
    DELETE: 'bg-red-100 text-red-700',
    HEAD: 'bg-purple-100 text-purple-700',
    OPTIONS: 'bg-slate-100 text-slate-600',
  };
  return colors[method.toUpperCase()] ?? 'bg-gray-100 text-gray-800';
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ApiDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;

  const [api, setApi] = useState<ApiDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const [routes, setRoutes] = useState<Route[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [subs, setSubs] = useState<SubscriptionItem[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);

  const [routeModal, setRouteModal] = useState(false);
  const [routeForm, setRouteForm] = useState({ path: '', method: 'GET', upstreamUrl: '', authTypes: [] as string[] });
  const [routeSaving, setRouteSaving] = useState(false);

  const [editRouteModal, setEditRouteModal] = useState<{ open: boolean; route: Route | null }>({ open: false, route: null });
  const [editRouteForm, setEditRouteForm] = useState({ path: '', method: 'GET', upstreamUrl: '', authTypes: [] as string[], enabled: true });
  const [editRouteSaving, setEditRouteSaving] = useState(false);

  const [authPolicy, setAuthPolicy] = useState<AuthPolicy>({ authMode: 'ANY', allowAnonymous: false, enabledAuthTypes: ['JWT'] });
  const [authPolicyLoading, setAuthPolicyLoading] = useState(false);
  const [authPolicySaving, setAuthPolicySaving] = useState(false);
  const [authSaveMsg, setAuthSaveMsg] = useState('');

  const [actionLoading, setActionLoading] = useState(false);
  const [showLifecycle, setShowLifecycle] = useState(false);

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  // Subscription review state
  const [reviewModal, setReviewModal] = useState<{ open: boolean; subId: string; action: string }>({ open: false, subId: '', action: '' });
  const [reviewReason, setReviewReason] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    get<ApiDetail>(`/v1/apis/${id}`)
      .then(setApi)
      .catch((err) => setError(err.message ?? 'Failed to load API'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (tab !== 'routes' && tab !== 'policies') return;
    setRoutesLoading(true);
    get<Route[]>(`/v1/apis/${id}/routes`).then(setRoutes).catch(() => setRoutes([])).finally(() => setRoutesLoading(false));
  }, [tab, id]);

  useEffect(() => {
    if (tab !== 'subscriptions') return;
    setSubsLoading(true);
    get<SubscriptionItem[]>(`/v1/subscriptions?apiId=${id}`).then(setSubs).catch(() => setSubs([])).finally(() => setSubsLoading(false));
  }, [tab, id]);

  useEffect(() => {
    if (tab !== 'auth-policy') return;
    setAuthPolicyLoading(true);
    get<AuthPolicy>(`/v1/apis/${id}/auth-policy`)
      .then((p) => setAuthPolicy({ ...p, enabledAuthTypes: p.enabledAuthTypes ?? ['JWT'] }))
      .catch(() => setAuthPolicy({ authMode: 'ANY', allowAnonymous: false, enabledAuthTypes: ['JWT'] }))
      .finally(() => setAuthPolicyLoading(false));
  }, [tab, id]);

  const performAction = useCallback(async (endpoint: string) => {
    if (!api) return;
    setActionLoading(true);
    try {
      await post<ApiDetail>(endpoint, {});
      const refreshed = await get<ApiDetail>(`/v1/apis/${id}`);
      setApi(refreshed);
      showToast('Action completed successfully');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally { setActionLoading(false); }
  }, [api, id]);

  const openReviewModal = (subId: string, action: string) => {
    setReviewModal({ open: true, subId, action });
    setReviewReason('');
  };

  const handleSubAction = async (subId: string, action: string, reason?: string) => {
    setReviewLoading(true);
    try {
      const updated = await post<SubscriptionItem>(`/v1/subscriptions/${subId}/${action}`, { reason: reason || undefined });
      setSubs((prev) => prev.map((s) => (s.id === subId ? { ...s, ...updated } : s)));
      setReviewModal({ open: false, subId: '', action: '' });
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setReviewLoading(false);
    }
  };

  const needsReason = (action: string) => ['reject', 'suspend', 'revoke'].includes(action);

  const subActionLabel: Record<string, string> = {
    approve: 'Approve', reject: 'Reject', suspend: 'Suspend', resume: 'Resume', revoke: 'Revoke',
  };

  const handleAddRoute = useCallback(async () => {
    setRouteSaving(true);
    try {
      const created = await post<Route>(`/v1/apis/${id}/routes`, routeForm);
      setRoutes((prev) => [...prev, created]);
      setRouteModal(false);
      setRouteForm({ path: '', method: 'GET', upstreamUrl: '', authTypes: [] });
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to add route', 'error');
    } finally { setRouteSaving(false); }
  }, [id, routeForm]);

  const refreshRoutes = useCallback(() => {
    setRoutesLoading(true);
    get<Route[]>(`/v1/apis/${id}/routes`).then(setRoutes).catch(() => setRoutes([])).finally(() => setRoutesLoading(false));
  }, [id]);

  const openEditRouteModal = useCallback((route: Route) => {
    setEditRouteForm({
      path: route.path,
      method: route.method,
      upstreamUrl: route.upstreamUrl,
      authTypes: route.authTypes ?? [],
      enabled: route.enabled,
    });
    setEditRouteModal({ open: true, route });
  }, []);

  const handleEditRoute = useCallback(async () => {
    if (!editRouteModal.route) return;
    setEditRouteSaving(true);
    try {
      await put<Route>(`/v1/apis/${id}/routes/${editRouteModal.route.id}`, editRouteForm);
      setEditRouteModal({ open: false, route: null });
      showToast('Route updated successfully');
      refreshRoutes();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update route', 'error');
    } finally { setEditRouteSaving(false); }
  }, [id, editRouteForm, editRouteModal.route, refreshRoutes]);

  const handleDeleteRoute = useCallback(async (route: Route) => {
    if (!window.confirm(`Are you sure you want to delete the route ${route.method} ${route.path}?`)) return;
    try {
      await del(`/v1/apis/${id}/routes/${route.id}`);
      showToast('Route deleted successfully');
      refreshRoutes();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete route', 'error');
    }
  }, [id, refreshRoutes]);

  const toggleEditAuth = (type: string) => {
    setEditRouteForm((prev) => ({
      ...prev,
      authTypes: prev.authTypes.includes(type)
        ? prev.authTypes.filter((t) => t !== type)
        : [...prev.authTypes, type],
    }));
  };

  const handleSaveAuthPolicy = useCallback(async () => {
    setAuthPolicySaving(true);
    setAuthSaveMsg('');
    try {
      await put<AuthPolicy>(`/v1/apis/${id}/auth-policy`, authPolicy);
      setAuthSaveMsg('success');
      setTimeout(() => setAuthSaveMsg(''), 3000);
    } catch (err: unknown) {
      setAuthSaveMsg('error');
    } finally { setAuthPolicySaving(false); }
  }, [id, authPolicy]);

  const toggleAuth = (type: string) => {
    setRouteForm((prev) => ({
      ...prev,
      authTypes: prev.authTypes.includes(type)
        ? prev.authTypes.filter((t) => t !== type)
        : [...prev.authTypes, type],
    }));
  };

  const toggleEnabledAuth = (type: string) => {
    setAuthPolicy((prev) => {
      const current = prev.enabledAuthTypes ?? [];
      const next = current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type];
      return { ...prev, enabledAuthTypes: next };
    });
  };

  // Derived early so columns can reference it
  const isRetired = api?.status?.toUpperCase() === 'RETIRED';

  const routeColumns: Column<Route>[] = useMemo(() => [
    {
      key: 'method', label: 'Method',
      render: (r) => <span className={`px-2.5 py-1 rounded-md text-xs font-bold font-mono ${methodColor(r.method)}`}>{r.method}</span>,
    },
    { key: 'path', label: 'Path' },
    { key: 'upstreamUrl', label: 'Upstream URL' },
    { key: 'authTypes', label: 'Auth', render: (r) => (r.authTypes ?? []).join(', ') || 'NONE' },
    {
      key: 'enabled', label: 'Status',
      render: (r) => r.enabled
        ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Active</span>
        : <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-slate-300" />Disabled</span>,
    },
    {
      key: 'actions', label: 'Actions',
      render: (r) => {
        if (isRetired) return <span className="text-xs text-slate-300">-</span>;
        return (
          <div className="flex gap-1.5">
            <button onClick={() => openEditRouteModal(r)}
              className="px-2 py-0.5 text-[11px] font-medium border rounded-md transition-colors bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100">
              Edit
            </button>
            <button onClick={() => handleDeleteRoute(r)}
              className="px-2 py-0.5 text-[11px] font-medium border rounded-md transition-colors bg-red-50 text-red-700 border-red-200 hover:bg-red-100">
              Delete
            </button>
          </div>
        );
      },
    },
  ], [isRetired, openEditRouteModal, handleDeleteRoute]);

  const subColumns: Column<SubscriptionItem>[] = [
    { key: 'applicationId', label: 'App ID', render: (s) => <code className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{s.applicationId.substring(0, 8)}...</code> },
    { key: 'planName', label: 'Plan', render: (s) => <span className="text-sm text-slate-700">{s.planName || s.planId?.substring(0, 8)}</span> },
    { key: 'status', label: 'Status', render: (s) => <StatusBadge status={s.status} size="sm" /> },
    { key: 'reason', label: 'Reason', render: (s) => s.reason ? <span className="text-xs text-slate-500 italic max-w-[200px] truncate block">{s.reason}</span> : <span className="text-xs text-slate-300">-</span> },
    { key: 'createdAt', label: 'Created', render: (s) => <span className="text-xs text-slate-500">{new Date(s.createdAt).toLocaleDateString()}</span> },
    {
      key: 'actions', label: 'Actions', render: (s) => {
        if (isRetired) return <span className="text-xs text-slate-300">-</span>;
        const actions: { action: string; label: string; style: string }[] = [];
        const st = s.status;
        if (st === 'PENDING') {
          actions.push({ action: 'approve', label: 'Approve', style: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' });
          actions.push({ action: 'reject', label: 'Reject', style: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' });
        }
        if (st === 'APPROVED' || st === 'ACTIVE') {
          actions.push({ action: 'suspend', label: 'Suspend', style: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' });
          actions.push({ action: 'revoke', label: 'Revoke', style: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' });
        }
        if (st === 'SUSPENDED') {
          actions.push({ action: 'resume', label: 'Resume', style: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' });
          actions.push({ action: 'revoke', label: 'Revoke', style: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' });
        }
        if (actions.length === 0) return <span className="text-xs text-slate-300">-</span>;
        return (
          <div className="flex gap-1.5">
            {actions.map((a) => (
              <button key={a.action} onClick={() => needsReason(a.action) ? openReviewModal(s.id, a.action) : handleSubAction(s.id, a.action)}
                className={`px-2 py-0.5 text-[11px] font-medium border rounded-md transition-colors ${a.style}`}>
                {a.label}
              </button>
            ))}
          </div>
        );
      },
    },
  ];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'routes', label: 'Routes' },
    { key: 'subscriptions', label: 'Subscriptions' },
    { key: 'deployments', label: 'Deployments' },
    { key: 'auth-policy', label: 'Authentication' },
    { key: 'policies', label: 'Policies' },
    { key: 'gateway-config', label: 'Gateway Config' },
  ];

  /* ---- Loading ---- */
  if (loading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-4 w-20 bg-slate-200 rounded" />
          <div className="h-8 w-1/3 bg-slate-200 rounded-lg" />
          <div className="h-4 w-1/2 bg-slate-200 rounded" />
          <div className="h-64 bg-slate-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !api) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error ?? 'API not found'}</div>
        <button onClick={() => { window.location.href = '/apis'; }} className="mt-4 text-sm text-purple-600 hover:text-purple-800 font-medium">
          &larr; Back to APIs
        </button>
      </div>
    );
  }

  const apiStatus = api.status?.toUpperCase() || 'CREATED';
  const versionStatus = api.versionStatus?.toUpperCase() || '';
  const retired = apiStatus === 'RETIRED';
  const sensitivity = api.sensitivity || 'LOW';

  // Status badge styles
  const SB: Record<string, string> = {
    CREATED: 'bg-slate-100 text-slate-700 ring-slate-300',
    DRAFT: 'bg-blue-50 text-blue-700 ring-blue-300',
    IN_REVIEW: 'bg-amber-50 text-amber-700 ring-amber-300',
    PUBLISHED: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
    DEPRECATED: 'bg-orange-50 text-orange-700 ring-orange-300',
    RETIRED: 'bg-red-50 text-red-700 ring-red-300',
    ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
    PENDING: 'bg-amber-50 text-amber-700 ring-amber-300',
  };
  const sensStyle: Record<string, string> = { LOW: 'bg-slate-100 text-slate-600', MEDIUM: 'bg-amber-100 text-amber-700', HIGH: 'bg-red-100 text-red-700', CRITICAL: 'bg-red-200 text-red-800' };

  // Build available actions from BOTH status fields
  type Action = { key: string; label: string; confirm: string; style: string; endpoint: string };
  const actions: Action[] = [];

  // API-level transitions
  if (apiStatus === 'CREATED' || apiStatus === 'DRAFT' || apiStatus === 'IN_REVIEW') {
    actions.push({ key: 'publish', label: 'Publish', confirm: 'Publish this API? It will appear in the developer catalog.', style: 'text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm', endpoint: `/v1/apis/${id}/publish` });
  }
  if (apiStatus === 'PUBLISHED') {
    actions.push({ key: 'deprecate', label: 'Deprecate', confirm: 'Deprecate this API? It remains accessible but discouraged.', style: 'text-white bg-amber-500 hover:bg-amber-600 shadow-sm', endpoint: `/v1/apis/${id}/deprecate` });
  }
  if (apiStatus === 'PUBLISHED' || apiStatus === 'DEPRECATED') {
    actions.push({ key: 'retire-api', label: 'Retire', confirm: 'Retire this API? It will be permanently removed from the gateway.', style: 'text-red-700 bg-red-50 hover:bg-red-100 border border-red-200', endpoint: `/v1/apis/${id}/retire` });
  }

  // Version-level transitions
  if (versionStatus === 'DRAFT' || apiStatus === 'DRAFT') {
    actions.push({ key: 'submit', label: 'Submit for Review', confirm: 'Submit this version for review? It will go through the approval chain.', style: 'text-white bg-blue-600 hover:bg-blue-700 shadow-sm', endpoint: `/v1/versions/${id}/submit` });
  }
  if (versionStatus === 'ACTIVE') {
    actions.push({ key: 'deprecate-ver', label: 'Deprecate Version', confirm: 'Deprecate this version?', style: 'text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200', endpoint: `/v1/versions/${id}/deprecate` });
    actions.push({ key: 'retire-ver', label: 'Retire Version', confirm: 'Retire this version? Routes will be disabled.', style: 'text-red-700 bg-red-50 hover:bg-red-100 border border-red-200', endpoint: `/v1/versions/${id}/retire` });
  }
  if (versionStatus === 'DEPRECATED') {
    actions.push({ key: 'retire-ver', label: 'Retire Version', confirm: 'Retire this version? Routes will be disabled.', style: 'text-red-700 bg-red-50 hover:bg-red-100 border border-red-200', endpoint: `/v1/versions/${id}/retire` });
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border backdrop-blur-sm animate-in slide-in-from-right max-w-sm ${
          toast.type === 'error' ? 'bg-red-50/95 border-red-200 text-red-800' : 'bg-emerald-50/95 border-emerald-200 text-emerald-800'
        }`}>
          {toast.type === 'error' ? (
            <svg className="w-5 h-5 shrink-0 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
          ) : (
            <svg className="w-5 h-5 shrink-0 text-emerald-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )}
          <div className="flex-1">
            <p className="text-sm font-medium">{toast.message}</p>
          </div>
          <button onClick={() => setToast(null)} className="shrink-0 text-current opacity-50 hover:opacity-100">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Back */}
      <button onClick={() => { window.location.href = '/apis'; }} className="text-sm text-slate-500 hover:text-purple-600 font-medium mb-3 inline-flex items-center gap-1 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        APIs
      </button>

      {/* ── Header row: title + statuses + actions ── */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 mb-5">
        <div className="flex items-center justify-between gap-4">
          {/* Left: name + meta */}
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="text-lg font-bold text-slate-900 truncate">{api.name}</h1>
            <span className="font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[11px] shrink-0">v{api.version}</span>
          </div>

          {/* Center: dual status + sensitivity */}
          <div className="flex items-center gap-2 shrink-0">
            {/* API Status */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400 font-medium uppercase">API</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 ${SB[apiStatus] || SB.CREATED}`}>{apiStatus}</span>
            </div>
            {/* Version Status */}
            {versionStatus && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-400 font-medium uppercase">VER</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 ${SB[versionStatus] || SB.DRAFT}`}>{versionStatus}</span>
              </div>
            )}
            {/* Sensitivity */}
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${sensStyle[sensitivity]}`}>{sensitivity}</span>
            {/* Maker-checker indicator */}
            {(sensitivity === 'HIGH' || sensitivity === 'CRITICAL') && (apiStatus === 'IN_REVIEW' || versionStatus === 'IN_REVIEW') && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 ring-1 ring-violet-300" title={sensitivity === 'CRITICAL' ? '3 approval levels + 24h cooldown' : '3 approval levels'}>
                <svg className="w-3 h-3 inline -mt-px mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
                Maker-Checker
              </span>
            )}
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {actions.map((a) => (
              <button key={a.key}
                onClick={() => { if (confirm(a.confirm)) performAction(a.endpoint); }}
                disabled={actionLoading}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-[13px] font-semibold rounded-lg transition-colors disabled:opacity-50 ${a.style}`}>
                {actionLoading ? <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" /> : null}
                {a.label}
              </button>
            ))}
            {retired && <span className="text-xs font-medium text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">Retired</span>}
            {/* Delete icon */}
            {!retired && (
              <button onClick={async () => { if (!confirm(`Delete "${api.name}"?`)) return; try { await del(`/v1/apis/${id}`); window.location.href = '/apis'; } catch (err) { showToast(err instanceof Error ? err.message : 'Failed', 'error'); } }}
                className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-1" title="Delete API">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Lifecycle Flow ── */}
      <div className="bg-white border border-slate-200 rounded-xl mb-5 overflow-hidden">
        <button onClick={() => setShowLifecycle(!showLifecycle)}
          className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
          <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">Lifecycle Flow</span>
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${showLifecycle ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
        </button>

        {showLifecycle && (() => {
          // Shared SVG node renderer
          const Node = ({ x, y, w, h, label, color, current, reachable }: { x: number; y: number; w: number; h: number; label: string; color: string; current: boolean; reachable: boolean }) => (
            <g>
              {current && <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={10} fill={color} opacity={0.12} />}
              <rect x={x} y={y} width={w} height={h} rx={7}
                fill={current ? color : reachable ? color + '15' : '#f8fafc'}
                stroke={current ? color : reachable ? color : '#e2e8f0'}
                strokeWidth={current ? 2 : reachable ? 1.5 : 1}
                strokeDasharray={reachable && !current ? '5,3' : ''} />
              {current && <circle cx={x + 12} cy={y + h / 2} r={3.5} fill="white" opacity={0.85} />}
              <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize={9.5} fontWeight={700} letterSpacing={0.3}
                fontFamily="ui-monospace,monospace" fill={current ? 'white' : reachable ? color : '#a1a1aa'}>{label}</text>
            </g>
          );
          // Arrow marker defs
          const Defs = () => (
            <defs>
              {['#94a3b8', '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#f97316', '#6366f1'].map(c => (
                <marker key={c} id={`m${c.slice(1)}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto">
                  <path d="M1,2 L8,5 L1,8" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                </marker>
              ))}
            </defs>
          );
          const marker = (color: string, active: boolean) => `url(#m${(active ? color : '#94a3b8').slice(1)})`;

          return (
          <div className="border-t border-slate-100 px-5 pb-5 pt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* ── API Status ── */}
              <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: apiStatus === 'RETIRED' ? '#ef4444' : apiStatus === 'PUBLISHED' ? '#10b981' : '#6366f1' }} />
                  <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">API Status</h4>
                </div>
                <svg viewBox="0 0 420 140" className="w-full">
                  <Defs />
                  {(() => {
                    // Layout: Row1: CREATED(10,10) → PUBLISHED(150,10) → DEPRECATED(280,10)
                    //         Row2: DRAFT(10,80) → IN_REVIEW(150,80)        RETIRED(330,80)
                    const W = 80, H = 28;
                    const n: Record<string, { x: number; y: number }> = {
                      CREATED: { x: 10, y: 15 }, PUBLISHED: { x: 140, y: 15 }, DEPRECATED: { x: 270, y: 15 },
                      DRAFT: { x: 10, y: 95 }, IN_REVIEW: { x: 140, y: 95 }, RETIRED: { x: 330, y: 55 },
                    };
                    const edges: [string, string, string, string][] = [
                      ['CREATED', 'PUBLISHED', 'publish', '#10b981'],
                      ['CREATED', 'DRAFT', '', '#3b82f6'],
                      ['DRAFT', 'IN_REVIEW', 'submit', '#3b82f6'],
                      ['IN_REVIEW', 'PUBLISHED', 'approve', '#10b981'],
                      ['PUBLISHED', 'DEPRECATED', 'deprecate', '#f59e0b'],
                      ['PUBLISHED', 'RETIRED', 'retire', '#ef4444'],
                      ['DEPRECATED', 'RETIRED', 'retire', '#ef4444'],
                    ];
                    const reachable = new Set(edges.filter(([f]) => f === apiStatus).map(([, t]) => t));
                    return <>
                      {/* Edges */}
                      {edges.map(([from, to, label, color]) => {
                        const f = n[from], t = n[to];
                        const active = apiStatus === from;
                        const lc = active ? color : '#d4d4d8';
                        const mk = marker(color, active);
                        // Horizontal same row
                        if (f.y === t.y) {
                          const y = f.y + H / 2;
                          return <g key={`${from}-${to}`}>
                            <line x1={f.x + W + 2} y1={y} x2={t.x - 2} y2={y} stroke={lc} strokeWidth={1.5} markerEnd={mk} />
                            {label && <text x={(f.x + W + t.x) / 2} y={y - 7} textAnchor="middle" fontSize={8} fontWeight={600} fill={active ? color : '#a1a1aa'} fontFamily="system-ui">{label}</text>}
                          </g>;
                        }
                        // Vertical: CREATED→DRAFT
                        if (from === 'CREATED' && to === 'DRAFT') {
                          return <g key={`${from}-${to}`}><line x1={f.x + W / 2} y1={f.y + H + 2} x2={t.x + W / 2} y2={t.y - 2} stroke={lc} strokeWidth={1.5} markerEnd={mk} /></g>;
                        }
                        // Diagonal: IN_REVIEW→PUBLISHED
                        if (from === 'IN_REVIEW' && to === 'PUBLISHED') {
                          return <g key={`${from}-${to}`}>
                            <path d={`M${f.x + W / 2},${f.y - 2} L${t.x + W / 2},${t.y + H + 2}`} stroke={lc} strokeWidth={1.5} fill="none" markerEnd={mk} />
                            <text x={f.x + W / 2 + 10} y={(f.y + t.y + H) / 2} fontSize={8} fontWeight={600} fill={active ? color : '#a1a1aa'} fontFamily="system-ui">{label}</text>
                          </g>;
                        }
                        // PUBLISHED→RETIRED (curve down)
                        if (from === 'PUBLISHED' && to === 'RETIRED') {
                          return <g key={`${from}-${to}`}>
                            <path d={`M${f.x + W},${f.y + H} Q${t.x - 10},${f.y + H + 15} ${t.x},${t.y + H / 2}`} stroke={lc} strokeWidth={1.5} fill="none" strokeDasharray={active ? '' : '5,3'} markerEnd={mk} />
                            <text x={(f.x + W + t.x) / 2 + 5} y={f.y + H + 22} fontSize={8} fontWeight={600} fill={active ? color : '#a1a1aa'} fontFamily="system-ui" textAnchor="middle">{label}</text>
                          </g>;
                        }
                        // DEPRECATED→RETIRED
                        if (from === 'DEPRECATED' && to === 'RETIRED') {
                          return <g key={`${from}-${to}`}>
                            <line x1={f.x + W} y1={f.y + H / 2 + 5} x2={t.x} y2={t.y + H / 2} stroke={lc} strokeWidth={1.5} markerEnd={mk} />
                            <text x={(f.x + W + t.x) / 2 + 8} y={(f.y + t.y + H) / 2 - 2} fontSize={8} fontWeight={600} fill={active ? color : '#a1a1aa'} fontFamily="system-ui">{label}</text>
                          </g>;
                        }
                        return null;
                      })}
                      {/* Nodes */}
                      {Object.entries(n).map(([id, pos]) => (
                        <Node key={id} x={pos.x} y={pos.y} w={W} h={H} label={id} color={({ CREATED: '#6366f1', DRAFT: '#3b82f6', IN_REVIEW: '#f59e0b', PUBLISHED: '#10b981', DEPRECATED: '#f59e0b', RETIRED: '#ef4444' })[id] || '#94a3b8'}
                          current={apiStatus === id} reachable={reachable.has(id)} />
                      ))}
                    </>;
                  })()}
                </svg>
                {/* Action buttons */}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {actions.filter(a => ['publish', 'deprecate', 'retire-api', 'submit'].includes(a.key)).map((a) => (
                    <button key={a.key} onClick={() => { if (confirm(a.confirm)) performAction(a.endpoint); }} disabled={actionLoading}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all disabled:opacity-50 ${a.style}`}>
                      {actionLoading && <div className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />}
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Version Status ── */}
              <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: versionStatus === 'ACTIVE' ? '#10b981' : versionStatus === 'DRAFT' ? '#3b82f6' : versionStatus === 'IN_REVIEW' ? '#f59e0b' : '#94a3b8' }} />
                  <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Version Status</h4>
                  {(sensitivity === 'HIGH' || sensitivity === 'CRITICAL') && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">MAKER-CHECKER</span>}
                </div>
                <svg viewBox="0 0 420 140" className="w-full">
                  <Defs />
                  {(() => {
                    const W = 80, H = 28;
                    const n: Record<string, { x: number; y: number }> = {
                      DRAFT: { x: 10, y: 15 }, IN_REVIEW: { x: 140, y: 15 }, ACTIVE: { x: 270, y: 15 },
                      DEPRECATED: { x: 140, y: 95 }, RETIRED: { x: 270, y: 95 },
                    };
                    const edges: [string, string, string, string, boolean][] = [
                      ['DRAFT', 'IN_REVIEW', 'submit', '#3b82f6', false],
                      ['IN_REVIEW', 'ACTIVE', 'approve', '#10b981', false],
                      ['IN_REVIEW', 'DRAFT', 'reject', '#ef4444', true],
                      ['ACTIVE', 'DEPRECATED', '', '#f97316', false],
                      ['ACTIVE', 'RETIRED', 'retire', '#ef4444', false],
                      ['DEPRECATED', 'RETIRED', 'retire', '#ef4444', false],
                    ];
                    const reachable = new Set(edges.filter(([f]) => f === (versionStatus || apiStatus)).map(([, t]) => t));
                    return <>
                      {edges.map(([from, to, label, color, isReject]) => {
                        const f = n[from], t = n[to];
                        const active = (versionStatus || apiStatus) === from;
                        const lc = active ? color : '#d4d4d8';
                        const mk = marker(color, active);
                        // Reject: curved arrow below
                        if (isReject) {
                          return <g key={`${from}-${to}-r`}>
                            <path d={`M${f.x + 15},${f.y + H + 2} C${f.x + 15},${f.y + H + 30} ${t.x + W - 15},${t.y + H + 30} ${t.x + W - 15},${t.y + H + 2}`} stroke={lc} strokeWidth={1.5} fill="none" markerEnd={mk} />
                            <text x={(f.x + t.x + W) / 2} y={f.y + H + 35} textAnchor="middle" fontSize={8} fontWeight={600} fill={active ? color : '#a1a1aa'} fontFamily="system-ui">{label}</text>
                          </g>;
                        }
                        // Horizontal
                        if (f.y === t.y) {
                          const y = f.y + H / 2;
                          return <g key={`${from}-${to}`}>
                            <line x1={f.x + W + 2} y1={y} x2={t.x - 2} y2={y} stroke={lc} strokeWidth={1.5} markerEnd={mk} />
                            {label && <text x={(f.x + W + t.x) / 2} y={y - 7} textAnchor="middle" fontSize={8} fontWeight={600} fill={active ? color : '#a1a1aa'} fontFamily="system-ui">{label}</text>}
                          </g>;
                        }
                        // Vertical / diagonal
                        if (from === 'ACTIVE' && to === 'DEPRECATED') {
                          return <g key={`${from}-${to}`}>
                            <path d={`M${f.x + W / 2 - 10},${f.y + H + 2} L${t.x + W / 2 + 10},${t.y - 2}`} stroke={lc} strokeWidth={1.5} fill="none" markerEnd={mk} />
                            <text x={(f.x + t.x + W) / 2 - 5} y={(f.y + H + t.y) / 2 + 3} fontSize={8} fontWeight={600} fill={active ? color : '#a1a1aa'} fontFamily="system-ui">deprecate</text>
                          </g>;
                        }
                        if (from === 'ACTIVE' && to === 'RETIRED') {
                          return <g key={`${from}-${to}`}>
                            <line x1={f.x + W / 2 + 10} y1={f.y + H + 2} x2={t.x + W / 2} y2={t.y - 2} stroke={lc} strokeWidth={1.5} markerEnd={mk} />
                            <text x={(f.x + W / 2 + t.x + W / 2) / 2 + 10} y={(f.y + H + t.y) / 2 + 3} fontSize={8} fontWeight={600} fill={active ? color : '#a1a1aa'} fontFamily="system-ui">{label}</text>
                          </g>;
                        }
                        // DEPRECATED→RETIRED
                        return <g key={`${from}-${to}`}>
                          <line x1={f.x + W + 2} y1={f.y + H / 2} x2={t.x - 2} y2={t.y + H / 2} stroke={lc} strokeWidth={1.5} markerEnd={mk} />
                          {label && <text x={(f.x + W + t.x) / 2} y={f.y + H / 2 - 7} textAnchor="middle" fontSize={8} fontWeight={600} fill={active ? color : '#a1a1aa'} fontFamily="system-ui">{label}</text>}
                        </g>;
                      })}
                      {Object.entries(n).map(([id, pos]) => (
                        <Node key={id} x={pos.x} y={pos.y} w={W} h={H} label={id} color={({ DRAFT: '#3b82f6', IN_REVIEW: '#f59e0b', ACTIVE: '#10b981', DEPRECATED: '#f97316', RETIRED: '#ef4444' })[id] || '#94a3b8'}
                          current={(versionStatus || apiStatus) === id} reachable={reachable.has(id)} />
                      ))}
                    </>;
                  })()}
                </svg>
                {/* Version actions */}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {actions.filter(a => ['submit', 'deprecate-ver', 'retire-ver'].includes(a.key)).map((a) => (
                    <button key={a.key} onClick={() => { if (confirm(a.confirm)) performAction(a.endpoint); }} disabled={actionLoading}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all disabled:opacity-50 ${a.style}`}>
                      {actionLoading && <div className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />}
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          );
        })()}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-6">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t.key ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-5">
          {/* Backend Base URL — editable */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Backend Base URL</h3>
            <p className="text-xs text-slate-400 mb-3">
              All routes for this API will proxy to this base URL + route path. Change this to point to a different backend.
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                defaultValue={api.backendBaseUrl || ''}
                id="backendBaseUrlInput"
                placeholder="https://api.example.com/v1"
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
              />
              <button
                onClick={async () => {
                  const input = document.getElementById('backendBaseUrlInput') as HTMLInputElement;
                  const newUrl = input?.value?.trim();
                  if (!newUrl) return;
                  try {
                    await put(`/v1/apis/${api.id}`, { backendBaseUrl: newUrl });
                    window.location.reload();
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Failed to update', 'error');
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
              >
                Save
              </button>
            </div>
            {api.backendBaseUrl && (
              <p className="text-xs text-slate-500 mt-2">
                Example: <code className="bg-slate-50 px-1.5 py-0.5 rounded text-[11px] font-mono">{api.backendBaseUrl}/your-route-path</code>
              </p>
            )}
          </div>

          {/* API Details */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
              {([
                ['Name', api.name], ['Version', api.version], ['Status', api.status],
                ['Protocol', api.protocolType ?? api.protocol ?? '-'], ['Visibility', api.visibility ?? '-'],
                ['Category', api.category ?? '-'], ['Tags', (api.tags ?? []).join(', ') || '-'],
                ['Sensitivity', api.sensitivity ?? 'LOW'], ['Version Status', api.versionStatus ?? '-'],
                ['Description', api.description ?? '-'],
                ['Created', new Date(api.createdAt).toLocaleString()],
                ['Updated', new Date(api.updatedAt).toLocaleString()],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</dt>
                  <dd className="mt-1 text-sm text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* ── Routes ── */}
      {tab === 'routes' && (
        <div>
          {!retired && (
          <div className="flex justify-end mb-4">
            <button onClick={() => setRouteModal(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              Add Route
            </button>
          </div>
          )}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <DataTable data={routes} columns={routeColumns} loading={routesLoading} />
          </div>
          <FormModal open={routeModal} onClose={() => setRouteModal(false)} title="Add Route" onSubmit={handleAddRoute} submitLabel="Add Route" loading={routeSaving}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Path *</label>
                <input type="text" value={routeForm.path} onChange={(e) => setRouteForm((f) => ({ ...f, path: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                  placeholder="/api/resource" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Method</label>
                <select value={routeForm.method} onChange={(e) => setRouteForm((f) => ({ ...f, method: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500">
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Upstream URL *</label>
                <input type="text" value={routeForm.upstreamUrl} onChange={(e) => setRouteForm((f) => ({ ...f, upstreamUrl: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                  placeholder="http://backend-service:8080/resource" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Auth Types</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {AUTH_TYPES.map((t) => (
                    <button key={t} type="button" onClick={() => toggleAuth(t)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                        routeForm.authTypes.includes(t)
                          ? 'bg-purple-50 border-purple-300 text-purple-700'
                          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </FormModal>
          <FormModal open={editRouteModal.open} onClose={() => setEditRouteModal({ open: false, route: null })} title="Edit Route" onSubmit={handleEditRoute} submitLabel="Save Changes" loading={editRouteSaving}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Path *</label>
                <input type="text" value={editRouteForm.path} onChange={(e) => setEditRouteForm((f) => ({ ...f, path: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                  placeholder="/api/resource" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Method</label>
                <select value={editRouteForm.method} onChange={(e) => setEditRouteForm((f) => ({ ...f, method: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500">
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Upstream URL *</label>
                <input type="text" value={editRouteForm.upstreamUrl} onChange={(e) => setEditRouteForm((f) => ({ ...f, upstreamUrl: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                  placeholder="http://backend-service:8080/resource" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Auth Types</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {AUTH_TYPES.map((t) => (
                    <button key={t} type="button" onClick={() => toggleEditAuth(t)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                        editRouteForm.authTypes.includes(t)
                          ? 'bg-purple-50 border-purple-300 text-purple-700'
                          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editRouteForm.enabled} onChange={(e) => setEditRouteForm((f) => ({ ...f, enabled: e.target.checked }))}
                    className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500/20" />
                  <span className="text-sm text-slate-600">Enabled</span>
                </label>
              </div>
            </div>
          </FormModal>
        </div>
      )}

      {/* ── Subscriptions ── */}
      {tab === 'subscriptions' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-slate-500">{subs.length} subscription{subs.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <DataTable data={subs} columns={subColumns} loading={subsLoading} />
          </div>

          {/* Review Modal (reject / suspend / revoke) */}
          <FormModal
            open={reviewModal.open}
            onClose={() => setReviewModal({ open: false, subId: '', action: '' })}
            title={`${subActionLabel[reviewModal.action] || reviewModal.action} Subscription`}
            onSubmit={() => handleSubAction(reviewModal.subId, reviewModal.action, reviewReason)}
            submitLabel={subActionLabel[reviewModal.action] || reviewModal.action}
            loading={reviewLoading}
          >
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Reason {reviewModal.action === 'reject' ? '*' : '(optional)'}
              </label>
              <textarea
                value={reviewReason}
                onChange={(e) => setReviewReason(e.target.value)}
                rows={3}
                placeholder={
                  reviewModal.action === 'reject' ? 'Explain why this subscription is being rejected...'
                  : reviewModal.action === 'suspend' ? 'Explain why this subscription is being suspended...'
                  : 'Reason for revoking this subscription...'
                }
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-vertical"
              />
            </div>
          </FormModal>
        </div>
      )}

      {/* ── Deployments ── */}
      {tab === 'deployments' && <DeploymentsTab apiId={id} apiName={api.name} readOnly={retired} />}

      {/* ── Authentication Policy ── */}
      {tab === 'auth-policy' && (
        <div className={`space-y-6 ${retired ? 'pointer-events-none opacity-60' : ''}`}>
          {retired && (
            <div className="pointer-events-auto opacity-100 mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
              This API is retired. Authentication policy is read-only.
            </div>
          )}
          {authPolicyLoading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Auth Type Selection */}
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="mb-5">
                  <h3 className="text-base font-semibold text-slate-900">Authentication Methods</h3>
                  <p className="text-sm text-slate-500 mt-1">Select which authentication types are accepted for this API. Disabled methods will be rejected at the gateway.</p>
                </div>

                <div className="space-y-3">
                  {AUTH_TYPES.map((type) => {
                    const info = AUTH_TYPE_INFO[type];
                    const enabled = (authPolicy.enabledAuthTypes ?? []).includes(type);
                    return (
                      <div
                        key={type}
                        onClick={() => toggleEnabledAuth(type)}
                        className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                          enabled
                            ? 'border-purple-200 bg-purple-50/50'
                            : 'border-slate-100 bg-slate-50/50 hover:border-slate-200'
                        }`}
                      >
                        {/* Icon */}
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          enabled ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-400'
                        }`}>
                          {info.icon}
                        </div>

                        {/* Label & description */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold ${enabled ? 'text-slate-900' : 'text-slate-500'}`}>{info.label}</p>
                          <p className={`text-xs mt-0.5 ${enabled ? 'text-slate-500' : 'text-slate-400'}`}>{info.desc}</p>
                        </div>

                        {/* Toggle */}
                        <div className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${enabled ? 'bg-purple-600' : 'bg-slate-200'}`}>
                          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Auth Mode & Settings */}
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="mb-5">
                  <h3 className="text-base font-semibold text-slate-900">Authentication Settings</h3>
                  <p className="text-sm text-slate-500 mt-1">Configure how multiple auth methods interact</p>
                </div>

                <div className="space-y-5">
                  {/* Auth Mode */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-3">Validation Mode</label>
                    <div className="grid grid-cols-2 gap-3">
                      {(['ANY', 'ALL'] as const).map((mode) => (
                        <button key={mode} type="button" onClick={() => setAuthPolicy({ ...authPolicy, authMode: mode })}
                          className={`p-4 rounded-xl border-2 text-left transition-all ${
                            authPolicy.authMode === mode
                              ? 'border-purple-300 bg-purple-50'
                              : 'border-slate-100 hover:border-slate-200'
                          }`}>
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              authPolicy.authMode === mode ? 'border-purple-600' : 'border-slate-300'
                            }`}>
                              {authPolicy.authMode === mode && <div className="w-2 h-2 rounded-full bg-purple-600" />}
                            </div>
                            <span className={`text-sm font-semibold ${authPolicy.authMode === mode ? 'text-purple-700' : 'text-slate-600'}`}>
                              {mode === 'ANY' ? 'Any Method' : 'All Methods'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 ml-6">
                            {mode === 'ANY' ? 'At least one auth method must succeed' : 'Every enabled auth method must succeed'}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Allow Anonymous */}
                  <div onClick={() => setAuthPolicy({ ...authPolicy, allowAnonymous: !authPolicy.allowAnonymous })}
                    className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      authPolicy.allowAnonymous ? 'border-amber-200 bg-amber-50/50' : 'border-slate-100 hover:border-slate-200'
                    }`}>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Allow Anonymous Access</p>
                      <p className="text-xs text-slate-500 mt-0.5">When enabled, unauthenticated requests pass through without validation</p>
                    </div>
                    <div className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${authPolicy.allowAnonymous ? 'bg-amber-500' : 'bg-slate-200'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${authPolicy.allowAnonymous ? 'left-[22px]' : 'left-0.5'}`} />
                    </div>
                  </div>

                  {/* Save */}
                  <div className="flex items-center gap-3 pt-2">
                    <button onClick={handleSaveAuthPolicy} disabled={authPolicySaving}
                      className="px-5 py-2.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2">
                      {authPolicySaving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                      {authPolicySaving ? 'Saving...' : 'Save Authentication Policy'}
                    </button>
                    {authSaveMsg === 'success' && (
                      <span className="text-sm text-green-600 flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                        Saved
                      </span>
                    )}
                    {authSaveMsg === 'error' && <span className="text-sm text-red-600">Failed to save</span>}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Policies ── */}
      {tab === 'policies' && <PoliciesTab apiId={id} routes={routes} readOnly={retired} />}

      {/* ── Gateway Config ── */}
      {tab === 'gateway-config' && <GatewayConfigTab apiId={id} readOnly={retired} />}
    </div>
  );
}

/* ================================================================== */
/* Deployments Tab                                                     */
/* ================================================================== */

interface Environment {
  id: string;
  name: string;
  slug: string;
  description: string;
  apiCount: number;
}

interface Deployment {
  deploymentId: string;
  apiId: string;
  apiName: string;
  environment: string;
  status: string;
  upstreamUrl?: string;
  deployedAt: string;
  deployedBy: string;
}

const ENV_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  dev: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  uat: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  preprod: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
  prod: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
};

function DeploymentsTab({ apiId, apiName, readOnly = false }: { apiId: string; apiName: string; readOnly?: boolean }) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [upstreamUrls, setUpstreamUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [envs, deps] = await Promise.all([
        get<Environment[]>('/v1/environments'),
        get<Deployment[]>(`/v1/environments/deployments?apiId=${apiId}`),
      ]);
      setEnvironments(envs);
      setDeployments(deps);
      // Initialize upstream URLs from existing deployments
      const urls: Record<string, string> = {};
      deps.forEach(d => { if (d.upstreamUrl) urls[d.environment] = d.upstreamUrl; });
      setUpstreamUrls(prev => ({ ...urls, ...prev }));
    } catch {
      setError('Failed to load deployment data');
    } finally {
      setLoading(false);
    }
  }, [apiId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDeploy = async (envSlug: string) => {
    const upstream = upstreamUrls[envSlug]?.trim();
    if (!upstream) { setError(`Please enter a backend URL for ${envSlug.toUpperCase()}`); return; }
    if (!confirm(`Deploy "${apiName}" to ${envSlug.toUpperCase()}?\n\nBackend: ${upstream}`)) return;
    setDeploying(envSlug);
    setError('');
    try {
      await post('/v1/environments/deploy', { apiId, targetEnvironment: envSlug, upstreamUrl: upstream });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment failed');
    } finally {
      setDeploying(null);
    }
  };

  const getDeployment = (slug: string) => deployments.find(d => d.environment === slug);

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {readOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
          This API is retired. Deployments are read-only.
        </div>
      )}
      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">{error}</div>
      )}

      {/* Environment Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {environments.map((env) => {
          const dep = getDeployment(env.slug);
          const isDeployed = !!dep;
          const style = ENV_STYLES[env.slug] || ENV_STYLES.dev;
          const isDeploying = deploying === env.slug;

          return (
            <div key={env.slug} className={`rounded-xl border ${isDeployed ? style.border : 'border-slate-200'} overflow-hidden`}>
              {/* Header */}
              <div className={`px-5 py-4 ${isDeployed ? style.bg : 'bg-slate-50'} flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${isDeployed ? style.dot : 'bg-slate-300'}`} />
                  <div>
                    <h3 className={`text-sm font-semibold ${isDeployed ? style.text : 'text-slate-600'}`}>
                      {env.name}
                    </h3>
                    <p className="text-xs text-slate-500">{env.slug}</p>
                  </div>
                </div>
                <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                  isDeployed ? 'bg-white/80 ' + style.text : 'bg-slate-200 text-slate-500'
                }`}>
                  {isDeployed ? dep.status : 'NOT DEPLOYED'}
                </span>
              </div>

              {/* Body */}
              <div className="bg-white px-5 py-4">
                {/* Backend URL input */}
                <div className="mb-3">
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">Backend URL</label>
                  <input
                    type="text"
                    value={upstreamUrls[env.slug] || ''}
                    onChange={(e) => setUpstreamUrls(prev => ({ ...prev, [env.slug]: e.target.value }))}
                    placeholder={`e.g. https://api-${env.slug}.example.com`}
                    disabled={readOnly}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </div>

                {isDeployed && (
                  <div className="space-y-1.5 text-sm mb-3">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Last deployed</span>
                      <span className="text-slate-700 font-medium">{new Date(dep.deployedAt).toLocaleString()}</span>
                    </div>
                    {dep.deployedBy && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">By</span>
                        <span className="text-slate-700 font-mono text-xs">{dep.deployedBy.substring(0, 8)}...</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Action */}
                <button
                  onClick={() => handleDeploy(env.slug)}
                  disabled={isDeploying || readOnly}
                  className={`w-full px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                    isDeployed
                      ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                      : 'bg-purple-600 text-white hover:bg-purple-700'
                  }`}
                >
                  {isDeploying ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Deploying...
                    </span>
                  ) : isDeployed ? 'Re-deploy' : 'Deploy'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Deployment History */}
      {deployments.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Deployment History</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Environment</th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Backend URL</th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Deployed At</th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Deployed By</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((dep) => {
                const style = ENV_STYLES[dep.environment] || ENV_STYLES.dev;
                return (
                  <tr key={dep.deploymentId} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                        {dep.environment.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <code className="text-xs font-mono text-slate-600 bg-slate-50 px-2 py-0.5 rounded">{dep.upstreamUrl || '-'}</code>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={dep.status} size="sm" />
                    </td>
                    <td className="px-5 py-3 text-slate-600">{new Date(dep.deployedAt).toLocaleString()}</td>
                    <td className="px-5 py-3 text-slate-500 font-mono text-xs">{dep.deployedBy ? `${dep.deployedBy.substring(0, 8)}...` : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Per-API Policies Tab                                                */
/* ================================================================== */

interface PolicyItem {
  id: string;
  name: string;
  type: string;
  description?: string;
  config?: string;
}

interface PolicyAttachment {
  id: string;
  policyId: string;
  policyName: string;
  policyType: string;
  apiId?: string;
  apiName?: string;
  routeId?: string;
  routePath?: string;
  scope: string;
  priority: number;
}

function PoliciesTab({ apiId, routes, readOnly = false }: { apiId: string; routes: Route[]; readOnly?: boolean }) {
  const [attachments, setAttachments] = useState<PolicyAttachment[]>([]);
  const [allPolicies, setAllPolicies] = useState<PolicyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Attach modal
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [attachMode, setAttachMode] = useState<'existing' | 'new'>('existing');
  const [attachForm, setAttachForm] = useState({ policyId: '', scope: 'API', routeId: '', priority: 0 });
  const [newTransformForm, setNewTransformForm] = useState({ name: '', description: '', config: '{}', scope: 'API', routeId: '', priority: 0 });
  const [attaching, setAttaching] = useState(false);

  // View/edit mapping
  const [viewingPolicy, setViewingPolicy] = useState<PolicyItem | null>(null);
  const [editConfig, setEditConfig] = useState('{}');
  const [saving, setSaving] = useState(false);

  const policyTypeBadge = (type: string) => {
    const styles: Record<string, string> = {
      RATE_LIMIT: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300',
      AUTH: 'bg-blue-100 text-blue-800 ring-1 ring-blue-300',
      TRANSFORM: 'bg-purple-100 text-purple-800 ring-1 ring-purple-300',
      CACHE: 'bg-cyan-100 text-cyan-800 ring-1 ring-cyan-300',
      CORS: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300',
      IP_FILTER: 'bg-red-100 text-red-800 ring-1 ring-red-300',
    };
    return styles[type?.toUpperCase()] || 'bg-gray-100 text-gray-800 ring-1 ring-gray-300';
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [attRes, polRes] = await Promise.all([
        get<PolicyAttachment[]>(`/v1/policies/attachments/api/${apiId}`),
        get<PolicyItem[]>('/v1/policies'),
      ]);
      setAttachments(attRes);
      setAllPolicies(Array.isArray(polRes) ? polRes : []);
    } catch {
      setError('Failed to load policies');
    } finally {
      setLoading(false);
    }
  }, [apiId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Attach existing policy
  const handleAttach = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttaching(true);
    setError('');
    try {
      await post('/v1/policies/attach', {
        policyId: attachForm.policyId,
        apiId,
        routeId: attachForm.scope === 'ROUTE' && attachForm.routeId ? attachForm.routeId : null,
        scope: attachForm.scope,
        priority: attachForm.priority,
      });
      setShowAttachModal(false);
      setAttachForm({ policyId: '', scope: 'API', routeId: '', priority: 0 });
      loadData();
    } catch {
      setError('Failed to attach policy');
    } finally {
      setAttaching(false);
    }
  };

  // Create new transform policy + attach in one step
  const handleCreateAndAttach = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttaching(true);
    setError('');
    try {
      // 1. Create the policy
      const created = await post<PolicyItem>('/v1/policies', {
        name: newTransformForm.name,
        type: 'TRANSFORM',
        description: newTransformForm.description,
        config: newTransformForm.config,
      });
      // 2. Attach it to this API
      await post('/v1/policies/attach', {
        policyId: created.id,
        apiId,
        routeId: newTransformForm.scope === 'ROUTE' && newTransformForm.routeId ? newTransformForm.routeId : null,
        scope: newTransformForm.scope,
        priority: newTransformForm.priority,
      });
      setShowAttachModal(false);
      setNewTransformForm({ name: '', description: '', config: '{}', scope: 'API', routeId: '', priority: 0 });
      loadData();
    } catch {
      setError('Failed to create and attach policy');
    } finally {
      setAttaching(false);
    }
  };

  const handleDetach = async (attachmentId: string) => {
    if (!confirm('Detach this policy?')) return;
    try {
      await del(`/v1/policies/attachments/${attachmentId}`);
      loadData();
    } catch {
      setError('Failed to detach policy');
    }
  };

  // Open mapping editor for a TRANSFORM policy
  const handleViewMapping = async (policyId: string) => {
    try {
      const policy = await get<PolicyItem>(`/v1/policies/${policyId}`);
      setViewingPolicy(policy);
      setEditConfig(policy.config || '{}');
    } catch {
      setError('Failed to load policy config');
    }
  };

  // Save updated mapping
  const handleSaveMapping = async () => {
    if (!viewingPolicy) return;
    setSaving(true);
    setError('');
    try {
      await put(`/v1/policies/${viewingPolicy.id}`, {
        name: viewingPolicy.name,
        type: viewingPolicy.type,
        config: editConfig,
      });
      setViewingPolicy(null);
      loadData();
    } catch {
      setError('Failed to save mapping');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 w-full animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <svg className="h-4 w-4 shrink-0 text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Attached Policies</h3>
          <p className="text-sm text-slate-500">Policies applied to this API and its routes</p>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <button
              onClick={() => { setAttachMode('new'); setShowAttachModal(true); }}
              className="inline-flex items-center gap-2 rounded-lg border border-purple-300 bg-purple-50 px-4 py-2.5 text-sm font-medium text-purple-700 shadow-sm transition hover:bg-purple-100"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              New Transform
            </button>
            <button
              onClick={() => { setAttachMode('existing'); setShowAttachModal(true); }}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-purple-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Attach Existing
            </button>
          </div>
        )}
      </div>

      {/* Attachments list */}
      {attachments.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <svg className="mx-auto h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <p className="mt-3 text-sm font-medium text-slate-400">No policies attached</p>
          <p className="mt-1 text-xs text-slate-400">Attach rate limiting, transformation, CORS, or other policies to this API</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Policy</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Type</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Scope</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Route</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Priority</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {attachments.map((att) => (
                <tr key={att.id} className="transition hover:bg-slate-50/80">
                  <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-900">{att.policyName}</td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${policyTypeBadge(att.policyType)}`}>
                      {att.policyType}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      att.scope === 'ROUTE' ? 'bg-teal-100 text-teal-800 ring-1 ring-teal-300' : 'bg-blue-100 text-blue-800 ring-1 ring-blue-300'
                    }`}>
                      {att.scope}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-slate-500">
                    {att.routePath || '\u2014'}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-slate-500">{att.priority}</td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <div className="flex items-center gap-2">
                      {att.policyType === 'TRANSFORM' && (
                        <button
                          onClick={() => handleViewMapping(att.policyId)}
                          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-purple-600 transition hover:bg-purple-50 ring-1 ring-purple-200"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          Configure Mapping
                        </button>
                      )}
                      {!readOnly && (
                        <button
                          onClick={() => handleDetach(att.id)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                          Detach
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── View/Edit Mapping Modal ── */}
      {viewingPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setViewingPolicy(null)}>
          <div className="mx-4 w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-0 shadow-2xl ring-1 ring-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Configure Mapping: {viewingPolicy.name}</h3>
                <p className="mt-0.5 text-sm text-slate-500">Edit request/response field mappings, headers, query params, and URL rewrite</p>
              </div>
              <button className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" onClick={() => setViewingPolicy(null)}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-5">
              <TransformationBuilder
                value={editConfig}
                onChange={(json: string) => setEditConfig(json)}
                apiUrl={process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082'}
              />
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
              <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50" onClick={() => setViewingPolicy(null)}>Cancel</button>
              <button
                onClick={handleSaveMapping}
                disabled={saving || readOnly}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                {saving ? 'Saving...' : 'Save Mapping'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Attach / Create Modal ── */}
      {showAttachModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowAttachModal(false)}>
          <div className={`mx-4 w-full max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-0 shadow-2xl ring-1 ring-slate-200 ${attachMode === 'new' ? 'max-w-3xl' : 'max-w-lg'}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {attachMode === 'new' ? 'Create & Attach Transform Policy' : 'Attach Existing Policy'}
                </h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  {attachMode === 'new' ? 'Define transformation mappings and attach to this API' : 'Link an existing policy to this API or a specific route'}
                </p>
              </div>
              <button className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" onClick={() => setShowAttachModal(false)}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Mode toggle */}
            <div className="flex border-b border-slate-200 px-6">
              <button type="button" onClick={() => setAttachMode('existing')}
                className={`relative px-4 py-3 text-sm font-medium transition ${attachMode === 'existing' ? 'text-purple-600' : 'text-slate-500 hover:text-slate-700'}`}>
                Attach Existing
                {attachMode === 'existing' && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-purple-600" />}
              </button>
              <button type="button" onClick={() => setAttachMode('new')}
                className={`relative px-4 py-3 text-sm font-medium transition ${attachMode === 'new' ? 'text-purple-600' : 'text-slate-500 hover:text-slate-700'}`}>
                Create New Transform
                {attachMode === 'new' && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-purple-600" />}
              </button>
            </div>

            {/* ── Attach Existing Form ── */}
            {attachMode === 'existing' && (
              <form onSubmit={handleAttach} className="space-y-5 px-6 py-5">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Policy</label>
                  <select className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                    value={attachForm.policyId} onChange={(e) => setAttachForm({ ...attachForm, policyId: e.target.value })} required>
                    <option value="">Select Policy...</option>
                    {allPolicies.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Scope</label>
                  <select className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                    value={attachForm.scope} onChange={(e) => setAttachForm({ ...attachForm, scope: e.target.value })}>
                    <option value="API">API (applies to all routes)</option>
                    <option value="ROUTE">ROUTE (specific route only)</option>
                  </select>
                </div>
                {attachForm.scope === 'ROUTE' && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Route</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                      value={attachForm.routeId} onChange={(e) => setAttachForm({ ...attachForm, routeId: e.target.value })} required>
                      <option value="">Select Route...</option>
                      {routes.map((r) => (<option key={r.id} value={r.id}>{r.method} {r.path}</option>))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Priority</label>
                  <input type="number" className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                    value={attachForm.priority} onChange={(e) => setAttachForm({ ...attachForm, priority: parseInt(e.target.value) || 0 })} min={0} />
                  <p className="mt-1.5 text-xs text-slate-500">Lower number = higher priority</p>
                </div>
                <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
                  <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50" onClick={() => setShowAttachModal(false)}>Cancel</button>
                  <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-50" disabled={attaching}>
                    {attaching ? 'Attaching...' : 'Attach Policy'}
                  </button>
                </div>
              </form>
            )}

            {/* ── Create New Transform Form ── */}
            {attachMode === 'new' && (
              <form onSubmit={handleCreateAndAttach} className="space-y-5 px-6 py-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Policy Name</label>
                    <input type="text" className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                      placeholder="e.g. User API Field Mapping" value={newTransformForm.name} onChange={(e) => setNewTransformForm({ ...newTransformForm, name: e.target.value })} required />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Description</label>
                    <input type="text" className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                      placeholder="Optional description" value={newTransformForm.description} onChange={(e) => setNewTransformForm({ ...newTransformForm, description: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Scope</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                      value={newTransformForm.scope} onChange={(e) => setNewTransformForm({ ...newTransformForm, scope: e.target.value })}>
                      <option value="API">API</option>
                      <option value="ROUTE">ROUTE</option>
                    </select>
                  </div>
                  {newTransformForm.scope === 'ROUTE' && (
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Route</label>
                      <select className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                        value={newTransformForm.routeId} onChange={(e) => setNewTransformForm({ ...newTransformForm, routeId: e.target.value })} required>
                        <option value="">Select Route...</option>
                        {routes.map((r) => (<option key={r.id} value={r.id}>{r.method} {r.path}</option>))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Priority</label>
                    <input type="number" className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                      value={newTransformForm.priority} onChange={(e) => setNewTransformForm({ ...newTransformForm, priority: parseInt(e.target.value) || 0 })} min={0} />
                  </div>
                </div>

                {/* Transformation Builder */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                  <TransformationBuilder
                    value={newTransformForm.config}
                    onChange={(json: string) => setNewTransformForm({ ...newTransformForm, config: json })}
                    apiUrl={process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082'}
                  />
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
                  <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50" onClick={() => setShowAttachModal(false)}>Cancel</button>
                  <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-50" disabled={attaching}>
                    {attaching && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                    {attaching ? 'Creating...' : 'Create & Attach'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Per-API Gateway Configuration Tab                                   */
/* ================================================================== */

function GatewayConfigTab({ apiId, readOnly = false }: { apiId: string; readOnly?: boolean }) {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    get<Record<string, unknown>>(`/v1/apis/${apiId}/gateway-config`)
      .then(setConfig).catch(() => setConfig({})).finally(() => setLoading(false));
  }, [apiId]);

  const update = (section: string, field: string, value: unknown) => {
    setConfig(prev => ({ ...prev, [section]: { ...(prev[section] as Record<string, unknown> || {}), [field]: value } }));
  };

  const getSection = (s: string): Record<string, unknown> => (config[s] as Record<string, unknown>) || {};
  const getBool = (s: string, f: string, def = false) => (getSection(s)[f] as boolean) ?? def;
  const getNum = (s: string, f: string, def = 0) => (getSection(s)[f] as number) ?? def;
  const getStr = (s: string, f: string, def = '') => (getSection(s)[f] as string) ?? def;
  const getArr = (s: string, f: string): string[] => (getSection(s)[f] as string[]) || [];

  const handleSave = async () => {
    setSaving(true); setMsg('');
    try {
      await put(`/v1/apis/${apiId}/gateway-config`, config);
      setMsg('success');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: unknown) { setMsg('error'); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <div className="bg-white border border-slate-200 rounded-xl p-12 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
    </div>
  );

  const Toggle = ({ section, field, def = false }: { section: string; field: string; def?: boolean }) => {
    const on = getBool(section, field, def);
    return (
      <div onClick={() => update(section, field, !on)}
        className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${on ? 'bg-purple-600' : 'bg-slate-200'}`}>
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </div>
    );
  };

  const NumInput = ({ section, field, def = 0 }: { section: string; field: string; def?: number }) => (
    <input type="number" className="w-32 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
      value={getNum(section, field, def)} onChange={e => update(section, field, parseInt(e.target.value) || 0)} />
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h3 className="text-base font-semibold text-slate-900 mb-4">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-4">
      <span className="w-48 text-sm text-slate-600 shrink-0">{label}</span>
      {children}
    </div>
  );

  return (
    <div className={`space-y-6 ${readOnly ? 'pointer-events-none opacity-60' : ''}`}>
      {readOnly && (
        <div className="pointer-events-auto opacity-100 mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
          This API is retired. Gateway configuration is read-only.
        </div>
      )}
      {msg && (
        <div className={`px-4 py-3 rounded-lg text-sm ${msg === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg === 'success' ? 'Gateway configuration saved successfully' : 'Failed to save configuration'}
        </div>
      )}

      <Section title="Load Balancing">
        <Row label="Upstream URLs">
          <textarea className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500" rows={3}
            placeholder="One URL per line" value={getArr('loadBalancing', 'upstreamUrls').join('\n')}
            onChange={e => update('loadBalancing', 'upstreamUrls', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))} />
        </Row>
        <Row label="Algorithm">
          <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
            value={getStr('loadBalancing', 'algorithm', 'round-robin')} onChange={e => update('loadBalancing', 'algorithm', e.target.value)}>
            <option value="round-robin">Round Robin</option><option value="weighted">Weighted</option>
          </select>
        </Row>
        <Row label="Health Check Enabled"><Toggle section="loadBalancing" field="healthCheckEnabled" def={true} /></Row>
        <Row label="Health Check Path">
          <input className="w-48 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
            value={getStr('loadBalancing', 'healthCheckPath', '/health')} onChange={e => update('loadBalancing', 'healthCheckPath', e.target.value)} />
        </Row>
        <Row label="Health Check Interval (s)"><NumInput section="loadBalancing" field="healthCheckIntervalSeconds" def={30} /></Row>
      </Section>

      <Section title="Circuit Breaker">
        <Row label="Enabled"><Toggle section="circuitBreaker" field="enabled" def={true} /></Row>
        <Row label="Failure Threshold"><NumInput section="circuitBreaker" field="failureThreshold" def={5} /></Row>
        <Row label="Reset Timeout (s)"><NumInput section="circuitBreaker" field="resetTimeoutSeconds" def={60} /></Row>
        <Row label="Half-Open Max Requests"><NumInput section="circuitBreaker" field="halfOpenMaxRequests" def={1} /></Row>
      </Section>

      <Section title="Response Caching">
        <Row label="Enabled"><Toggle section="caching" field="enabled" /></Row>
        <Row label="Cache TTL (s)"><NumInput section="caching" field="ttlSeconds" def={300} /></Row>
        <Row label="Include Query Params"><Toggle section="caching" field="includeQueryParams" def={true} /></Row>
        <Row label="Include Auth Header"><Toggle section="caching" field="includeAuthHeader" /></Row>
      </Section>

      <Section title="Rate Limit Override">
        <Row label="Override Plan Limits"><Toggle section="rateLimitOverride" field="enabled" /></Row>
        <Row label="Requests / Second"><NumInput section="rateLimitOverride" field="requestsPerSecond" /></Row>
        <Row label="Requests / Minute"><NumInput section="rateLimitOverride" field="requestsPerMinute" /></Row>
        <Row label="Requests / Day"><NumInput section="rateLimitOverride" field="requestsPerDay" /></Row>
        <Row label="Burst Allowance"><NumInput section="rateLimitOverride" field="burstAllowance" def={10} /></Row>
        <Row label="Enforcement">
          <div className="flex gap-3">
            {['SOFT', 'STRICT'].map(e => (
              <button key={e} type="button" onClick={() => update('rateLimitOverride', 'enforcement', e)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg border-2 transition-all ${
                  getStr('rateLimitOverride', 'enforcement', 'SOFT') === e
                    ? e === 'STRICT' ? 'border-red-300 bg-red-50 text-red-700' : 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-slate-100 text-slate-400 hover:border-slate-200'
                }`}>{e}</button>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="IP Filtering">
        <Row label="IP Whitelist">
          <textarea className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500" rows={2}
            placeholder="One IP/CIDR per line" value={getArr('ipFilter', 'whitelist').join('\n')}
            onChange={e => update('ipFilter', 'whitelist', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))} />
        </Row>
        <Row label="IP Blacklist">
          <textarea className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500" rows={2}
            placeholder="One IP/CIDR per line" value={getArr('ipFilter', 'blacklist').join('\n')}
            onChange={e => update('ipFilter', 'blacklist', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))} />
        </Row>
      </Section>

      <Section title="Security &amp; CORS">
        <Row label="CORS Allowed Origins">
          <textarea className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500" rows={2}
            placeholder="One origin per line" value={getArr('security', 'corsOrigins').join('\n')}
            onChange={e => update('security', 'corsOrigins', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))} />
        </Row>
      </Section>

      <Section title="Timeouts">
        <Row label="Connect Timeout (ms)"><NumInput section="timeouts" field="connectTimeoutMs" def={10000} /></Row>
        <Row label="Read Timeout (ms)"><NumInput section="timeouts" field="readTimeoutMs" def={60000} /></Row>
        <Row label="Max Request Body (bytes)"><NumInput section="timeouts" field="maxRequestBodyBytes" def={10485760} /></Row>
      </Section>

      <button onClick={handleSave} disabled={saving}
        className="px-6 py-2.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2">
        {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        {saving ? 'Saving...' : 'Save Gateway Configuration'}
      </button>
    </div>
  );
}

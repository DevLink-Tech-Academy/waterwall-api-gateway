'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { DataTable } from '@gateway/shared-ui';
import type { Column } from '@gateway/shared-ui';

const ANALYTICS_URL = process.env.NEXT_PUBLIC_ANALYTICS_URL || 'http://localhost:8083';

interface DashboardStats {
  totalRequests: number;
  avgLatency: number;
  errorRate: number;
  activeApis: number;
}

interface TopApi {
  apiId?: string;
  apiName?: string;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number;
  errorRate: number;
  [key: string]: unknown;
}

interface TopConsumer {
  consumerId: string;
  consumerName?: string;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number;
  [key: string]: unknown;
}

interface LatencyBreakdown {
  apiId: string;
  apiName: string;
  totalRequests: number;
  avgTotalMs: number;
  avgUpstreamMs: number;
  avgGatewayMs: number;
  p95TotalMs: number;
  p95UpstreamMs: number;
  maxTotalMs: number;
  maxUpstreamMs: number;
}

interface RequestSample {
  id: number;
  method: string;
  path: string;
  statusCode: number;
  totalMs: number;
  upstreamMs: number;
  gatewayMs: number;
  clientIp: string;
  createdAt: string;
}

const RANGES = ['1h', '6h', '24h', '7d', '30d'] as const;
type Range = typeof RANGES[number];

function fetchAnalytics<T>(path: string): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('jwt_token') || '' : '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${ANALYTICS_URL}${path}`, { headers }).then((r) => {
    if (!r.ok) throw new Error('Failed');
    return r.json();
  });
}

/* ------------------------------------------------------------------ */
/*  Skeleton placeholders                                              */
/* ------------------------------------------------------------------ */

function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="animate-pulse space-y-3">
        <div className="h-3 w-24 rounded bg-gray-200" />
        <div className="h-7 w-32 rounded bg-gray-200" />
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-48 rounded bg-gray-200" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 w-full rounded bg-gray-100" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stat card                                                          */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  borderColor: string;
  iconBg: string;
  iconColor: string;
}

function StatCard({ label, value, icon, borderColor, iconBg, iconColor }: StatCardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${borderColor}`}
      style={{ borderLeftWidth: '4px' }}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
        </div>
        <div
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold ${iconBg} ${iconColor}`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SVG icons (inline, no extra deps)                                  */
/* ------------------------------------------------------------------ */

function DownloadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-12 w-12 text-red-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14c1.34 0 2.17-1.46 1.5-2.63L13.5 4.01c-.67-1.17-2.33-1.17-3 0L3.43 16.37c-.67 1.17.16 2.63 1.5 2.63z" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-12 w-12 text-gray-300"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6m16 0H4" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Latency breakdown helpers                                          */
/* ------------------------------------------------------------------ */

function StatusBadge({ code }: { code: number }) {
  let colorClass = 'bg-green-100 text-green-700';
  if (code >= 500) colorClass = 'bg-red-100 text-red-700';
  else if (code >= 400) colorClass = 'bg-amber-100 text-amber-700';
  else if (code >= 300) colorClass = 'bg-blue-100 text-blue-700';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${colorClass}`}>
      {code}
    </span>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'bg-sky-100 text-sky-700',
    POST: 'bg-emerald-100 text-emerald-700',
    PUT: 'bg-violet-100 text-violet-700',
    PATCH: 'bg-orange-100 text-orange-700',
    DELETE: 'bg-red-100 text-red-700',
  };
  const cls = colors[method.toUpperCase()] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold ${cls}`}>
      {method}
    </span>
  );
}

/** Proportional stacked bar: blue = upstream, orange = gateway */
function LatencyBar({
  upstreamMs,
  gatewayMs,
  height = 8,
}: {
  upstreamMs: number;
  gatewayMs: number;
  height?: number;
}) {
  const total = upstreamMs + gatewayMs;
  if (total <= 0) return <div className="h-2 w-full rounded-full bg-gray-100" />;
  const upstreamPct = Math.round((upstreamMs / total) * 100);
  const gatewayPct = 100 - upstreamPct;
  return (
    <div
      className="flex w-full overflow-hidden rounded-full"
      style={{ height }}
      title={`Upstream: ${upstreamMs}ms  Gateway: ${gatewayMs}ms`}
    >
      {upstreamPct > 0 && (
        <div className="bg-blue-500" style={{ width: `${upstreamPct}%` }} />
      )}
      {gatewayPct > 0 && (
        <div className="bg-orange-400" style={{ width: `${gatewayPct}%` }} />
      )}
    </div>
  );
}

function RequestSamplesTable({ samples, loading }: { samples: RequestSample[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="animate-pulse space-y-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 rounded bg-gray-100" />
        ))}
      </div>
    );
  }
  if (samples.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-gray-400">
        No recent samples available.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium uppercase tracking-wider text-gray-500">
            <th className="px-4 py-2 text-left">Method + Path</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-left">Breakdown</th>
            <th className="px-4 py-2 text-right">Total (ms)</th>
            <th className="px-4 py-2 text-left">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((s) => (
            <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/60">
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <MethodBadge method={s.method} />
                  <span className="font-mono text-xs text-gray-700">{s.path}</span>
                </div>
              </td>
              <td className="px-4 py-2">
                <StatusBadge code={s.statusCode} />
              </td>
              <td className="px-4 py-2 min-w-[120px]">
                <LatencyBar upstreamMs={s.upstreamMs} gatewayMs={s.gatewayMs} />
                <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
                  <span className="text-blue-500">{s.upstreamMs}ms</span>
                  <span className="text-orange-400">{s.gatewayMs}ms</span>
                </div>
              </td>
              <td className="px-4 py-2 text-right font-mono font-semibold text-gray-800">
                {s.totalMs}
              </td>
              <td className="px-4 py-2 text-xs text-gray-400">
                {new Date(s.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LatencyBreakdownSection({ range }: { range: Range }) {
  const [breakdown, setBreakdown] = useState<LatencyBreakdown[]>([]);
  const [loadingBreakdown, setLoadingBreakdown] = useState(true);
  const [breakdownError, setBreakdownError] = useState('');
  const [expandedApiId, setExpandedApiId] = useState<string | null>(null);
  const [samplesMap, setSamplesMap] = useState<Record<string, RequestSample[]>>({});
  const [loadingSamplesFor, setLoadingSamplesFor] = useState<string | null>(null);

  useEffect(() => {
    setLoadingBreakdown(true);
    setBreakdownError('');
    setExpandedApiId(null);
    fetchAnalytics<LatencyBreakdown[]>(`/v1/analytics/dashboard/latency-breakdown?range=${range}`)
      .then((data) => setBreakdown(Array.isArray(data) ? data : []))
      .catch(() => setBreakdownError('Failed to load latency breakdown'))
      .finally(() => setLoadingBreakdown(false));
  }, [range]);

  const handleToggleExpand = useCallback(
    async (apiId: string) => {
      if (expandedApiId === apiId) {
        setExpandedApiId(null);
        return;
      }
      setExpandedApiId(apiId);
      if (samplesMap[apiId]) return; // already loaded
      setLoadingSamplesFor(apiId);
      try {
        const samples = await fetchAnalytics<RequestSample[]>(
          `/v1/analytics/dashboard/api/${apiId}/samples?limit=20`,
        );
        setSamplesMap((prev) => ({ ...prev, [apiId]: Array.isArray(samples) ? samples : [] }));
      } catch {
        setSamplesMap((prev) => ({ ...prev, [apiId]: [] }));
      } finally {
        setLoadingSamplesFor(null);
      }
    },
    [expandedApiId, samplesMap],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-4">
        <h3 className="text-base font-semibold text-gray-900">Latency Breakdown by API</h3>
        <p className="mt-1 text-xs text-gray-400">
          Per-API latency averages with upstream vs gateway split. Click{' '}
          <span className="font-medium text-gray-600">expand</span> to see recent request samples.
        </p>
        <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-5 rounded-full bg-blue-500" />
            Upstream
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-5 rounded-full bg-orange-400" />
            Gateway
          </span>
        </div>
      </div>

      {breakdownError && (
        <div className="px-6 py-4 text-sm text-red-600">{breakdownError}</div>
      )}

      {loadingBreakdown ? (
        <div className="p-6">
          <TableSkeleton rows={4} />
        </div>
      ) : breakdown.length === 0 && !breakdownError ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <EmptyIcon />
          <p className="text-sm text-gray-500">No latency data available for this time range.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-6 py-3 text-left">API Name</th>
                <th className="px-4 py-3 text-right">Requests</th>
                <th className="px-4 py-3 text-right">Avg Total</th>
                <th className="px-4 py-3 text-left min-w-[160px]">Avg Upstream</th>
                <th className="px-4 py-3 text-left min-w-[160px]">Avg Gateway</th>
                <th className="px-4 py-3 text-right">P95 Total</th>
                <th className="px-4 py-3 text-right">Max Total</th>
                <th className="px-4 py-3 text-center">Samples</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => {
                const isExpanded = expandedApiId === row.apiId;
                const isLoadingSamples = loadingSamplesFor === row.apiId;
                const avgTotal = row.avgTotalMs ?? 0;
                const avgUpstream = row.avgUpstreamMs ?? 0;
                const avgGateway = row.avgGatewayMs ?? 0;
                return (
                  <>
                    <tr
                      key={row.apiId}
                      className={`border-b border-gray-100 transition-colors ${isExpanded ? 'bg-indigo-50/40' : 'hover:bg-gray-50/60'}`}
                    >
                      <td className="px-6 py-3 font-medium text-gray-900">
                        {row.apiName || row.apiId}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {(row.totalRequests ?? 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-800">
                        {avgTotal.toFixed(1)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-12 text-right tabular-nums text-xs text-blue-600">
                            {avgUpstream.toFixed(1)}ms
                          </span>
                          <div className="flex-1">
                            <LatencyBar upstreamMs={avgUpstream} gatewayMs={avgGateway} height={6} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-12 text-right tabular-nums text-xs text-orange-500">
                            {avgGateway.toFixed(1)}ms
                          </span>
                          <div className="flex-1">
                            <LatencyBar upstreamMs={avgGateway} gatewayMs={avgUpstream} height={6} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {(row.p95TotalMs ?? 0).toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {(row.maxTotalMs ?? 0).toFixed(0)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleToggleExpand(row.apiId)}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 ${
                            isExpanded
                              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {isLoadingSamples ? (
                            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                            </svg>
                          ) : (
                            <svg
                              className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2.5}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                          {isExpanded ? 'Collapse' : 'Expand'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${row.apiId}-samples`} className="bg-indigo-50/20">
                        <td colSpan={8} className="px-6 py-3">
                          <div className="rounded-lg border border-indigo-100 bg-white shadow-inner">
                            <div className="border-b border-gray-100 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                              Recent Request Samples — {row.apiName || row.apiId}
                            </div>
                            <RequestSamplesTable
                              samples={samplesMap[row.apiId] ?? []}
                              loading={isLoadingSamples}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>('24h');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [topApis, setTopApis] = useState<TopApi[]>([]);
  const [topConsumers, setTopConsumers] = useState<TopConsumer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [dashboard, apis, consumers] = await Promise.all([
          fetchAnalytics<DashboardStats>(`/v1/analytics/dashboard?range=${range}`),
          fetchAnalytics<TopApi[]>(`/v1/analytics/dashboard/top-apis?range=${range}`),
          fetchAnalytics<TopConsumer[]>(`/v1/analytics/dashboard/top-consumers?range=${range}`),
        ]);
        setStats(dashboard);
        setTopApis(Array.isArray(apis) ? apis : []);
        setTopConsumers(Array.isArray(consumers) ? consumers : []);
      } catch {
        setError('Failed to load analytics data');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [range]);

  const handleExportCsv = async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('jwt_token') || '' : '';
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${ANALYTICS_URL}/v1/analytics/dashboard/export?range=${range}&format=csv`, { headers });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-${range}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Failed to export CSV', 'error');
    }
  };

  const apiColumns: Column<TopApi>[] = useMemo(
    () => [
      {
        key: 'apiName',
        label: 'API Name',
        render: (row) => {
          const apiId = row.apiId;
          const name = row.apiName || row.apiId || 'Unknown';
          return apiId ? (
            <Link
              href={`/apis/${apiId}`}
              className="text-purple-600 hover:text-purple-800 font-medium underline decoration-purple-300 underline-offset-2 hover:decoration-purple-600 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {name}
            </Link>
          ) : <span>{name}</span>;
        },
      },
      {
        key: 'requestCount',
        label: 'Requests',
        render: (row) => (row.requestCount ?? 0).toLocaleString(),
      },
      {
        key: 'avgLatencyMs',
        label: 'Avg Latency',
        render: (row) => `${row.avgLatencyMs ?? 0}ms`,
      },
      {
        key: 'errorRate',
        label: 'Error Rate',
        render: (row) => (
          <span className={(row.errorRate ?? 0) > 5 ? 'font-semibold text-red-600' : 'font-semibold text-green-600'}>
            {(row.errorRate ?? 0).toFixed(2)}%
          </span>
        ),
      },
    ],
    [],
  );

  const consumerColumns: Column<TopConsumer>[] = useMemo(
    () => [
      {
        key: 'consumerName',
        label: 'Consumer',
        render: (row) => <span>{row.consumerName || row.consumerId || 'Unknown'}</span>,
      },
      {
        key: 'requestCount',
        label: 'Requests',
        render: (row) => (row.requestCount ?? 0).toLocaleString(),
      },
      {
        key: 'avgLatencyMs',
        label: 'Avg Latency',
        render: (row) => `${row.avgLatencyMs ?? 0}ms`,
      },
    ],
    [],
  );

  /* ---------- Loading skeleton ---------- */
  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        {/* Header skeleton */}
        <div className="animate-pulse space-y-2">
          <div className="h-8 w-40 rounded bg-gray-200" />
          <div className="h-4 w-64 rounded bg-gray-200" />
        </div>

        {/* Range pills skeleton */}
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <div key={r} className="h-8 w-14 animate-pulse rounded-full bg-gray-200" />
          ))}
        </div>

        {/* Stat cards skeleton */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>

        {/* Table skeletons */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <TableSkeleton />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <TableSkeleton rows={3} />
        </div>
      </div>
    );
  }

  /* ---------- Main render ---------- */
  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border max-w-sm ${
          toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          {toast.type === 'error' ? (
            <svg className="w-5 h-5 shrink-0 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
          ) : (
            <svg className="w-5 h-5 shrink-0 text-emerald-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )}
          <p className="text-sm font-medium flex-1">{toast.message}</p>
          <button onClick={() => setToast(null)} className="shrink-0 opacity-50 hover:opacity-100">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* ---- Header ---- */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">API traffic analytics and insights</p>
        </div>

        <button
          onClick={handleExportCsv}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          <DownloadIcon />
          Export CSV
        </button>
      </div>

      {/* ---- Error state ---- */}
      {error && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 py-12 text-center">
          <AlertIcon />
          <p className="text-sm font-medium text-red-700">{error}</p>
          <button
            onClick={() => setRange(range)}
            className="mt-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* ---- Time Range Selector ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium uppercase tracking-wider text-gray-500">Range</span>
        {RANGES.map((r) => (
          <button
            key={r}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${
              range === r
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>

      {/* ---- Stat Cards ---- */}
      {stats && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Requests"
            value={(stats.totalRequests ?? 0).toLocaleString()}
            icon="REQ"
            borderColor="border-l-blue-500"
            iconBg="bg-blue-100"
            iconColor="text-blue-600"
          />
          <StatCard
            label="Avg Latency"
            value={`${stats.avgLatency ?? 0}ms`}
            icon="LAT"
            borderColor="border-l-amber-500"
            iconBg="bg-amber-100"
            iconColor="text-amber-600"
          />
          <StatCard
            label="Error Rate"
            value={
              <span className={(stats.errorRate ?? 0) > 5 ? 'text-red-600' : 'text-green-600'}>
                {(stats.errorRate ?? 0).toFixed(2)}%
              </span>
            }
            icon="ERR"
            borderColor="border-l-red-500"
            iconBg="bg-red-100"
            iconColor="text-red-600"
          />
          <StatCard
            label="Active APIs"
            value={stats.activeApis ?? 0}
            icon="API"
            borderColor="border-l-green-500"
            iconBg="bg-green-100"
            iconColor="text-green-600"
          />
        </div>
      )}

      {/* ---- Top APIs ---- */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-base font-semibold text-gray-900">Top APIs</h3>
          <p className="text-xs text-gray-400 mt-1">Click an API name to view its detail page</p>
        </div>
        <div className="p-6 pt-2">
          {topApis.length > 0 ? (
            <DataTable data={topApis} columns={apiColumns} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <EmptyIcon />
              <p className="text-sm text-gray-500">No API data available for this time range.</p>
            </div>
          )}
        </div>
      </div>

      {/* ---- Top Consumers ---- */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-base font-semibold text-gray-900">Top Consumers</h3>
        </div>
        <div className="p-6 pt-2">
          {topConsumers.length > 0 ? (
            <DataTable data={topConsumers} columns={consumerColumns} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <EmptyIcon />
              <p className="text-sm text-gray-500">No consumer data available for this time range.</p>
            </div>
          )}
        </div>
      </div>

      {/* ---- Latency Breakdown by API ---- */}
      <LatencyBreakdownSection range={range} />
    </div>
  );
}

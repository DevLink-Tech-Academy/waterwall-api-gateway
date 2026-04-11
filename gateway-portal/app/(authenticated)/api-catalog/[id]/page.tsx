'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token') || localStorage.getItem('admin_token') || localStorage.getItem('jwt_token');
}
function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

interface Route {
  id: string;
  method: string;
  path: string;
  upstreamUrl: string;
  authTypes: string[];
  enabled: boolean;
}

interface ApiDetail {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  status: string;
  visibility: string;
  protocolType: string;
  tags: string[];
  authMode: string;
  allowAnonymous: boolean;
  orgId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  routes: Route[];
  apiGroupId: string;
  apiGroupName: string;
  sensitivity: string;
  versionStatus: string;
  deprecatedMessage: string;
  successorVersionId: string;
  contextPath: string;
}

interface ApiVersion {
  id: string;
  version: string;
  versionStatus: string;
  createdAt: string;
}

interface Environment {
  slug: string;
  name: string;
}

interface Deployment {
  id: string;
  deploymentId: string;
  apiId: string;
  environment: string;
  environmentSlug?: string;
  status: string;
  authEnforcement: string;
}

interface Application {
  id: string;
  name: string;
  status: string;
}

interface Plan {
  id: string;
  name: string;
  description: string;
  rateLimits: string;
  quota: string;
  enforcement: string;
}

type TabId = 'overview' | 'endpoints' | 'api-docs' | 'try-it' | 'subscribe' | 'sdks';

const METHOD_COLORS: Record<string, { bg: string; color: string }> = {
  GET: { bg: '#dcfce7', color: '#16a34a' },
  POST: { bg: '#dbeafe', color: '#2563eb' },
  PUT: { bg: '#fef3c7', color: '#d97706' },
  DELETE: { bg: '#fef2f2', color: '#dc2626' },
  PATCH: { bg: '#ffedd5', color: '#ea580c' },
};

const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL || 'http://localhost:8081';

export default function ApiDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [api, setApi] = useState<ApiDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // Swagger UI refs (must be before any conditional returns)
  const swaggerRef = useRef<HTMLDivElement>(null);
  const swaggerLoaded = useRef(false);

  // Version state
  const [versions, setVersions] = useState<ApiVersion[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);

  // Subscribe state
  interface ExistingSub { id: string; applicationId: string; apiId: string; planId: string; status: string; createdAt: string; environmentSlug?: string; }
  const [apps, setApps] = useState<Application[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [existingSubs, setExistingSubs] = useState<ExistingSub[]>([]);
  const [selectedApp, setSelectedApp] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedEnv, setSelectedEnv] = useState('dev');
  const [subscribing, setSubscribing] = useState(false);
  const [subSuccess, setSubSuccess] = useState('');
  const [subError, setSubError] = useState('');
  const [subDataLoaded, setSubDataLoaded] = useState(false);

  // Try It state
  const [trySelectedRoute, setTrySelectedRoute] = useState(0);
  const [tryApiKey, setTryApiKey] = useState('');
  const [tryApiKeys, setTryApiKeys] = useState<{ id: string; name: string; keyPrefix: string }[]>([]);
  const [tryBody, setTryBody] = useState('');
  const [tryHeaders, setTryHeaders] = useState('');
  const [tryResponse, setTryResponse] = useState<{ status: number; statusText: string; headers: Record<string, string>; body: string; latency: number } | null>(null);
  const [tryLoading, setTryLoading] = useState(false);
  const [tryError, setTryError] = useState('');
  const [tryApps, setTryApps] = useState<Application[]>([]);
  const [trySelectedApp, setTrySelectedApp] = useState('');

  // Load apps and keys for Try It tab
  useEffect(() => {
    if (activeTab !== 'try-it') return;
    fetch(`${IDENTITY_URL}/v1/applications?page=0&size=100`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const list = Array.isArray(d) ? d : d.content || [];
        const active = list.filter((a: Application) => a.status === 'ACTIVE');
        setTryApps(active);
        if (active.length > 0 && !trySelectedApp) setTrySelectedApp(active[0].id);
      })
      .catch(() => {});
  }, [activeTab]);

  // Load API keys when app is selected
  useEffect(() => {
    if (!trySelectedApp) return;
    fetch(`${IDENTITY_URL}/v1/applications/${trySelectedApp}/api-keys`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const keys = Array.isArray(d) ? d : d.content || [];
        setTryApiKeys(keys.filter((k: { status: string }) => k.status === 'ACTIVE'));
      })
      .catch(() => setTryApiKeys([]));
  }, [trySelectedApp]);

  const routes = api?.routes || [];

  // Auto-select auth mode based on selected route's authTypes
  useEffect(() => {
    const selectedRoute = routes[trySelectedRoute];
    if (!selectedRoute) return;
    const authTypes = selectedRoute.authTypes || [];
    const supportsJwt = authTypes.some(t => ['JWT', 'OAUTH2', 'OAUTH2_JWT'].includes(t));
    const supportsApiKey = authTypes.includes('API_KEY');
    // Default to the first supported auth type
    if (supportsApiKey && !supportsJwt) {
      // Route only supports API Key — switch to API Key mode
      setTryApiKey('enter-key');
    } else if (supportsJwt && !supportsApiKey) {
      // Route only supports JWT — switch to JWT mode
      setTryApiKey('');
    }
    // If both are supported, keep the current selection
  }, [trySelectedRoute, routes]);

  const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080';

  const handleTryIt = async () => {
    const route = routes[trySelectedRoute];
    if (!route) return;
    const isSoap = api?.protocolType === 'SOAP';

    if (isSoap && !tryBody.trim()) {
      setTryError('SOAP requests require an XML body. Click "Insert SOAP envelope" to get a template.');
      return;
    }

    setTryLoading(true);
    setTryError('');
    setTryResponse(null);

    // Build full gateway URL with context path
    const ctxPath = api?.contextPath ? `/${api.contextPath}` : '';
    const url = `${GATEWAY_URL}${ctxPath}${route.path}`;
    const hdrs: Record<string, string> = {
      'Content-Type': isSoap ? 'text/xml; charset=utf-8' : 'application/json',
    };
    if (isSoap && tryBody.trim()) {
      // Extract SOAPAction from body if present
      const actionMatch = tryBody.match(/SOAPAction:\s*"?([^"\n]+)"?/i);
      if (actionMatch) hdrs['SOAPAction'] = actionMatch[1].trim();
    }
    const hasValidApiKey = tryApiKey && tryApiKey !== 'enter-key';
    if (hasValidApiKey) hdrs['X-API-Key'] = tryApiKey;
    const token = getToken();
    if (token && !hasValidApiKey) hdrs['Authorization'] = `Bearer ${token}`;

    // Parse custom headers
    if (tryHeaders.trim()) {
      tryHeaders.split('\n').forEach(line => {
        const [k, ...v] = line.split(':');
        if (k && v.length) hdrs[k.trim()] = v.join(':').trim();
      });
    }

    const start = Date.now();
    try {
      const fetchOpts: RequestInit = { method: route.method, headers: hdrs };
      if (isSoap || (['POST', 'PUT', 'PATCH'].includes(route.method) && tryBody.trim())) {
        fetchOpts.body = tryBody;
      }
      const res = await fetch(url, fetchOpts);
      const latency = Date.now() - start;
      const respHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { respHeaders[k] = v; });
      let body = '';
      try { body = await res.text(); } catch { body = ''; }
      // Format JSON responses; leave XML as-is (already readable)
      try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* not JSON — keep as text/XML */ }
      setTryResponse({ status: res.status, statusText: res.statusText, headers: respHeaders, body, latency });
    } catch (err) {
      setTryError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setTryLoading(false);
    }
  };

  useEffect(() => {
    async function fetchApi() {
      try {
        const res = await fetch(`${API_BASE}/v1/apis/${id}`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data = await res.json();
        setApi(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load API details');
      } finally {
        setLoading(false);
      }
    }
    if (id) fetchApi();
  }, [id]);

  // Load versions and deployments once we have the API
  useEffect(() => {
    if (!api?.apiGroupId) return;
    // Fetch versions for this API group
    fetch(`${API_BASE}/v1/versions?apiGroupId=${api.apiGroupId}`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        const list = Array.isArray(data) ? data : data.content || [];
        setVersions(list.map((v: ApiDetail) => ({ id: v.id, version: v.version, versionStatus: v.versionStatus, createdAt: v.createdAt })));
      })
      .catch(() => {});
    // Fetch deployments for this API
    fetch(`${API_BASE}/v1/environments/deployments?apiId=${id}`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setDeployments(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [api?.apiGroupId, id]);

  // Load apps, plans, and existing subscriptions when subscribe tab is opened
  useEffect(() => {
    if (activeTab !== 'subscribe') return;
    async function loadSubscribeData() {
      try {
        const [appsRes, plansRes, subsRes] = await Promise.all([
          fetch(`${IDENTITY_URL}/v1/applications?page=0&size=100`, { headers: authHeaders() }),
          fetch(`${API_BASE}/v1/plans`, { headers: authHeaders() }),
          fetch(`${API_BASE}/v1/subscriptions?page=0&size=200`, { headers: authHeaders() }),
        ]);
        if (appsRes.ok) {
          const d = await appsRes.json();
          const list = (d.content || d || []).filter((a: Application) => a.status === 'ACTIVE');
          setApps(list);
          if (list.length > 0 && !selectedApp) setSelectedApp(list[0].id);
        }
        if (plansRes.ok) {
          const d = await plansRes.json();
          const list = Array.isArray(d) ? d : d.content || [];
          setPlans(list);
          if (list.length > 0 && !selectedPlan) setSelectedPlan(list[0].id);
        }
        if (subsRes.ok) {
          const d = await subsRes.json();
          const allSubs: ExistingSub[] = d.content || d || [];
          // Filter subs for this API
          setExistingSubs(allSubs.filter((s) => s.apiId === id && s.status !== 'REVOKED' && s.status !== 'REJECTED'));
        }
      } catch { /* silent */ }
      finally { setSubDataLoaded(true); }
    }
    loadSubscribeData();
  }, [activeTab]);

  // When app selection changes, pre-select current plan if already subscribed
  useEffect(() => {
    if (!selectedApp || existingSubs.length === 0) return;
    const existing = existingSubs.find((s) => s.applicationId === selectedApp);
    if (existing) {
      setSelectedPlan(existing.planId);
    }
  }, [selectedApp, existingSubs]);

  const currentSubForApp = existingSubs.find((s) => s.applicationId === selectedApp);
  const isAlreadySubscribed = !!currentSubForApp;
  const isChangingPlan = isAlreadySubscribed && currentSubForApp.planId !== selectedPlan;

  const handleSubscribe = async () => {
    if (!selectedApp || !selectedPlan) return;
    setSubscribing(true);
    setSubError('');
    setSubSuccess('');
    try {
      // If changing plan, unsubscribe first
      if (isAlreadySubscribed && isChangingPlan) {
        const delRes = await fetch(`${API_BASE}/v1/subscriptions/${currentSubForApp.id}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
        if (!delRes.ok && delRes.status !== 204) {
          const body = await delRes.json().catch(() => null);
          throw new Error(body?.message || 'Failed to remove existing subscription');
        }
      }

      // Create new subscription (skip if same plan)
      if (!isAlreadySubscribed || isChangingPlan) {
        const res = await fetch(`${API_BASE}/v1/subscriptions`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ applicationId: selectedApp, apiId: id, planId: selectedPlan, environmentSlug: selectedEnv }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message || `Subscription failed (${res.status})`);
        }
      }

      setSubSuccess(isChangingPlan ? 'Plan changed successfully!' : 'Subscription created successfully!');
      // Refresh subs
      const subsRes = await fetch(`${API_BASE}/v1/subscriptions?page=0&size=200`, { headers: authHeaders() });
      if (subsRes.ok) {
        const d = await subsRes.json();
        const allSubs: ExistingSub[] = d.content || d || [];
        setExistingSubs(allSubs.filter((s) => s.apiId === id && s.status !== 'REVOKED' && s.status !== 'REJECTED'));
      }
    } catch (err) {
      setSubError(err instanceof Error ? err.message : 'Subscription failed');
    } finally {
      setSubscribing(false);
    }
  };

  // Load API spec when API Docs tab is selected
  const [specJson, setSpecJson] = useState<object | null>(null);
  const [specRaw, setSpecRaw] = useState<string | null>(null);
  const [specError, setSpecError] = useState('');

  const isOpenApiProtocol = !api?.protocolType || ['REST', 'OPENAPI_3', 'SWAGGER_2'].includes(api.protocolType);

  useEffect(() => {
    if (activeTab !== 'api-docs' || !id) return;
    // Fetch spec with auth
    fetch(`${API_BASE}/v1/governance/specs/${id}/openapi`, { headers: authHeaders() })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load spec (${r.status})`);
        const text = await r.text();
        // Try JSON parse for OpenAPI/Swagger specs
        try {
          const json = JSON.parse(text);
          setSpecJson(json);
        } catch {
          // Not JSON — store as raw text (WSDL, GraphQL SDL, Protobuf, etc.)
          setSpecRaw(text);
        }
      })
      .catch((err) => setSpecError(err instanceof Error ? err.message : 'Failed to load API spec'));
  }, [activeTab, id]);

  useEffect(() => {
    if (!specJson || !swaggerRef.current || swaggerLoaded.current) return;
    swaggerLoaded.current = true;

    // Override servers and security schemes so Swagger UI uses gateway auth
    const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080';
    const rawSpec = specJson as Record<string, unknown>;

    // Override security schemes to use X-API-Key
    const gatewaySecuritySchemes: Record<string, unknown> = {
      'X-API-Key': { type: 'apiKey', name: 'X-API-Key', in: 'header', description: 'Gateway API Key (e.g. gw_live_...)' },
      'BearerAuth': { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT Bearer Token' },
    };

    // Replace security references in the spec
    const components = { ...((rawSpec.components || {}) as Record<string, unknown>), securitySchemes: gatewaySecuritySchemes };

    // Map old security names to new ones in global security
    const globalSecurity = [{ 'X-API-Key': [] as string[] }];

    const specWithGateway = {
      ...rawSpec,
      servers: [{ url: `${GATEWAY_URL}${api?.contextPath ? '/' + api.contextPath : ''}`, description: 'Waterwall API Gateway' }],
      components,
      security: globalSecurity,
      // Also override Swagger 2.0 securityDefinitions if present
      securityDefinitions: gatewaySecuritySchemes,
    };

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js';
    script.onload = () => {
      if (swaggerRef.current && (window as unknown as Record<string, unknown>).SwaggerUIBundle) {
        const SwaggerUIBundle = (window as unknown as Record<string, unknown>).SwaggerUIBundle as (config: Record<string, unknown>) => void;
        SwaggerUIBundle({
          spec: specWithGateway,
          domNode: swaggerRef.current,
          deepLinking: true,
          defaultModelsExpandDepth: 1,
          docExpansion: 'list',
          filter: true,
          showExtensions: true,
          showCommonExtensions: true,
          tryItOutEnabled: false,
        });
      }
    };
    document.body.appendChild(script);
  }, [specJson]);

  if (loading) {
    return (
      <div>
        <div style={{ height: 16, width: 120, backgroundColor: '#f1f5f9', borderRadius: 4, marginBottom: 20 }} />
        <div style={{ height: 28, width: 300, backgroundColor: '#f1f5f9', borderRadius: 6, marginBottom: 8 }} />
        <div style={{ height: 16, width: 200, backgroundColor: '#f8fafc', borderRadius: 4, marginBottom: 32 }} />
        <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 24, height: 200 }} />
      </div>
    );
  }

  if (error || !api) {
    return (
      <div style={{ textAlign: 'center', padding: 64 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{'\u{274C}'}</div>
        <p style={{ fontSize: 16, color: '#dc2626', marginBottom: 16 }}>{error || 'API not found'}</p>
        <a href="/api-catalog" style={{ color: '#3b82f6', fontSize: 14, fontWeight: 500 }}>
          &larr; Back to Catalog
        </a>
      </div>
    );
  }



  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'endpoints', label: 'Endpoints', count: routes.length },
    { id: 'api-docs', label: 'API Docs' },
    { id: 'try-it', label: 'Try It' },
    { id: 'sdks', label: 'SDKs' },
    { id: 'subscribe', label: 'Subscribe' },
  ];

  return (
    <div>
      {/* Breadcrumb */}
      <a href="/api-catalog" style={{ fontSize: 13, color: '#3b82f6', textDecoration: 'none', fontWeight: 500 }}>
        &larr; Back to Catalog
      </a>

      {/* Header */}
      <div style={{ marginTop: 16, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>{api.name}</h1>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { label: api.category || 'General', bg: '#eff6ff', color: '#3b82f6' },
                { label: api.status, bg: api.status === 'PUBLISHED' ? '#dcfce7' : '#fef3c7', color: api.status === 'PUBLISHED' ? '#16a34a' : '#d97706' },
                { label: api.version, bg: '#f1f5f9', color: '#64748b' },
                { label: api.protocolType || 'REST', bg: '#f3e8ff', color: '#7c3aed' },
                { label: api.visibility, bg: '#f0fdf4', color: '#16a34a' },
              ].map((badge) => (
                <span key={badge.label} style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12,
                  backgroundColor: badge.bg, color: badge.color,
                }}>
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Version Selector + Deprecation Warning + Environments */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* Version selector */}
        {versions.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>Version:</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {versions.filter((v) => v.versionStatus !== 'RETIRED').map((v) => (
                <a key={v.id} href={`/api-catalog/${v.id}`}
                  style={{
                    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    textDecoration: 'none', transition: 'all 0.15s',
                    backgroundColor: v.id === id ? '#3b82f6' : v.versionStatus === 'DEPRECATED' ? '#fef3c7' : '#f1f5f9',
                    color: v.id === id ? '#fff' : v.versionStatus === 'DEPRECATED' ? '#d97706' : '#475569',
                  }}>
                  {v.version}{v.versionStatus === 'DEPRECATED' ? ' (deprecated)' : v.versionStatus === 'DRAFT' ? ' (draft)' : ''}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Environment availability */}
        {deployments.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>Deployed to:</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {deployments.map((d) => (
                <span key={(d.environment || d.environmentSlug)} style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  backgroundColor: (d.environment || d.environmentSlug) === 'prod' ? '#dcfce7' : (d.environment || d.environmentSlug) === 'dev' ? '#dbeafe' : '#fef3c7',
                  color: (d.environment || d.environmentSlug) === 'prod' ? '#16a34a' : (d.environment || d.environmentSlug) === 'dev' ? '#2563eb' : '#d97706',
                }}>
                  {((d.environment || d.environmentSlug) || 'N/A').toUpperCase()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Sensitivity */}
        {api.sensitivity && api.sensitivity !== 'LOW' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>Sensitivity:</span>
            <span style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              backgroundColor: api.sensitivity === 'CRITICAL' ? '#fef2f2' : api.sensitivity === 'HIGH' ? '#fff1f2' : '#fef3c7',
              color: api.sensitivity === 'CRITICAL' ? '#dc2626' : api.sensitivity === 'HIGH' ? '#be123c' : '#d97706',
            }}>
              {api.sensitivity}
            </span>
          </div>
        )}
      </div>

      {/* Deprecation Warning */}
      {api.versionStatus === 'DEPRECATED' && (
        <div style={{
          padding: '12px 16px', backgroundColor: '#fef3c7', border: '1px solid #fde68a',
          borderRadius: 8, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>{'\u26A0\uFE0F'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#92400e' }}>This version is deprecated</div>
            <div style={{ fontSize: 13, color: '#a16207' }}>
              {api.deprecatedMessage || 'Please migrate to a newer version.'}
            </div>
          </div>
          {api.successorVersionId && (
            <a href={`/api-catalog/${api.successorVersionId}`}
              style={{ padding: '6px 14px', backgroundColor: '#fff', border: '1px solid #fde68a', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#92400e', textDecoration: 'none' }}>
              View newer version &rarr;
            </a>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e2e8f0', marginBottom: 24 }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer',
              borderBottom: `2px solid ${activeTab === tab.id ? '#3b82f6' : 'transparent'}`,
              color: activeTab === tab.id ? '#3b82f6' : '#94a3b8',
              backgroundColor: 'transparent', marginBottom: -2, transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                backgroundColor: activeTab === tab.id ? '#dbeafe' : '#f1f5f9',
                color: activeTab === tab.id ? '#2563eb' : '#94a3b8',
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div>
          {/* Description */}
          <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 24, marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#334155', margin: '0 0 12px' }}>Description</h3>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, margin: 0 }}>
              {api.description || 'No description available.'}
            </p>
          </div>

          {/* Supported Authentication */}
          {(() => {
            const allAuthTypes = Array.from(new Set(routes.flatMap((r) => r.authTypes || [])));
            const AUTH_INFO: Record<string, { label: string; desc: string; icon: string; bg: string; color: string; border: string }> = {
              API_KEY: { label: 'API Key', desc: 'Send your key via X-API-Key header or query parameter', icon: '\u{1F511}', bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
              OAUTH2: { label: 'OAuth2 / JWT', desc: 'Bearer token via Authorization header using OAuth2 flow', icon: '\u{1F6E1}\uFE0F', bg: '#f5f3ff', color: '#7c3aed', border: '#c4b5fd' },
              JWT: { label: 'JWT Bearer', desc: 'Pass a signed JWT in the Authorization: Bearer header', icon: '\u{1F4DC}', bg: '#fefce8', color: '#ca8a04', border: '#fde68a' },
              BASIC: { label: 'Basic Auth', desc: 'HTTP Basic authentication with client ID and secret', icon: '\u{1F512}', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
              MTLS: { label: 'Mutual TLS', desc: 'Client certificate authentication for high-security APIs', icon: '\u{1F9F0}', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
            };
            if (allAuthTypes.length === 0 && api.authMode === 'NONE') return null;
            return (
              <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 24, marginBottom: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#334155', margin: '0 0 4px' }}>Supported Authentication</h3>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>
                  {api.authMode === 'REQUIRED' ? 'Authentication is required for all endpoints.' :
                   api.authMode === 'NONE' ? 'No authentication required.' :
                   'Authentication is optional — anonymous access is allowed for some endpoints.'}
                </p>
                {allAuthTypes.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                    {allAuthTypes.map((authType) => {
                      const info = AUTH_INFO[authType] || { label: authType, desc: '', icon: '\u{1F510}', bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0' };
                      return (
                        <div key={authType} style={{
                          padding: '14px 16px', borderRadius: 8,
                          border: `1px solid ${info.border}`, backgroundColor: info.bg,
                          display: 'flex', gap: 12, alignItems: 'flex-start',
                        }}>
                          <span style={{ fontSize: 22, lineHeight: 1 }}>{info.icon}</span>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: info.color }}>{info.label}</div>
                            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, lineHeight: 1.4 }}>{info.desc}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: '#64748b' }}>
                    {api.allowAnonymous ? 'This API allows anonymous access — no authentication needed.' : 'Check individual endpoints for authentication requirements.'}
                  </p>
                )}
              </div>
            );
          })()}

          {/* Details Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 24 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#334155', margin: '0 0 16px' }}>Details</h3>
              {[
                { label: 'Protocol', value: api.protocolType || 'REST' },
                { label: 'Auth Mode', value: api.authMode || 'ANY' },
                { label: 'Anonymous Access', value: api.allowAnonymous ? 'Allowed' : 'Not allowed' },
                { label: 'Created', value: new Date(api.createdAt).toLocaleDateString() },
                { label: 'Updated', value: new Date(api.updatedAt).toLocaleDateString() },
              ].map((row) => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <span style={{ color: '#94a3b8' }}>{row.label}</span>
                  <span style={{ color: '#0f172a', fontWeight: 500 }}>{row.value}</span>
                </div>
              ))}
            </div>

            <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 24 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#334155', margin: '0 0 16px' }}>Tags</h3>
              {api.tags && api.tags.length > 0 ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {api.tags.map((tag) => (
                    <span key={tag} style={{
                      fontSize: 13, padding: '4px 12px', borderRadius: 6,
                      backgroundColor: '#f1f5f9', color: '#475569',
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: '#94a3b8' }}>No tags</p>
              )}

              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#334155', margin: '24px 0 12px' }}>Quick Start</h3>
              <pre style={{
                padding: 14, backgroundColor: '#0f172a', color: '#e2e8f0', borderRadius: 8,
                fontSize: 12, overflow: 'auto', lineHeight: 1.6,
              }}>
{`curl -X GET "${API_BASE}/v1/apis/${api.id}" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Accept: application/json"`}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Endpoints Tab */}
      {activeTab === 'endpoints' && (
        <div>
          {routes.length === 0 ? (
            <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 48, textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{'\u{1F517}'}</div>
              <p style={{ fontSize: 14, color: '#475569' }}>No endpoints documented for this API.</p>
            </div>
          ) : (
            <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              {routes.map((route, idx) => {
                const mc = METHOD_COLORS[route.method] || METHOD_COLORS.GET;
                return (
                  <div key={route.id || idx} style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 20px', borderTop: idx > 0 ? '1px solid #f1f5f9' : 'none',
                  }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                      backgroundColor: mc.bg, color: mc.color, fontFamily: 'monospace', minWidth: 56, textAlign: 'center',
                    }}>
                      {route.method}
                    </span>
                    <code style={{ fontSize: 13, color: '#0f172a', fontWeight: 500 }}>{route.path}</code>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      {(route.authTypes || []).map((auth) => (
                        <span key={auth} style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 4,
                          backgroundColor: '#f1f5f9', color: '#64748b',
                        }}>
                          {auth}
                        </span>
                      ))}
                      {route.enabled === false && (
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, backgroundColor: '#fef2f2', color: '#dc2626' }}>
                          Disabled
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Try It Tab */}
      {activeTab === 'try-it' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Left: Request Builder */}
          <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 20px' }}>Request</h3>

            {/* Select Endpoint */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Endpoint</label>
              <select
                value={trySelectedRoute}
                onChange={(e) => setTrySelectedRoute(Number(e.target.value))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, outline: 'none' }}
              >
                {routes.map((r, i) => (
                  <option key={i} value={i}>{r.method} {r.path}</option>
                ))}
              </select>
            </div>

            {/* Select Application */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Application</label>
              {tryApps.length === 0 ? (
                <div style={{ fontSize: 13, color: '#94a3b8' }}>
                  No applications found. <a href="/apps?action=create" style={{ color: '#3b82f6' }}>Create one</a>
                </div>
              ) : (
                <select
                  value={trySelectedApp}
                  onChange={(e) => setTrySelectedApp(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, outline: 'none' }}
                >
                  {tryApps.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Authentication */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Authentication
              </label>
              {(() => {
                const selectedRoute = routes[trySelectedRoute];
                const authTypes = selectedRoute?.authTypes || [];
                if (authTypes.length > 0) {
                  return (
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, padding: '6px 10px', backgroundColor: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      This endpoint requires: {authTypes.map(t => (
                        <span key={t} style={{ display: 'inline-block', marginLeft: 4, padding: '1px 6px', borderRadius: 4, backgroundColor: '#e0e7ff', color: '#4338ca', fontSize: 11, fontWeight: 600 }}>{t}</span>
                      ))}
                    </div>
                  );
                }
                return null;
              })()}
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => setTryApiKey('')}
                  style={{
                    padding: '6px 14px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
                    border: !tryApiKey ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                    backgroundColor: !tryApiKey ? '#eff6ff' : '#fff',
                    color: !tryApiKey ? '#2563eb' : '#64748b', fontWeight: 500,
                  }}
                >
                  JWT Token
                </button>
                <button
                  type="button"
                  onClick={() => setTryApiKey('enter-key')}
                  style={{
                    padding: '6px 14px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
                    border: tryApiKey ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                    backgroundColor: tryApiKey ? '#eff6ff' : '#fff',
                    color: tryApiKey ? '#2563eb' : '#64748b', fontWeight: 500,
                  }}
                >
                  API Key
                </button>
              </div>
              {tryApiKey !== '' ? (
                <div>
                  <input
                    type="text"
                    value={tryApiKey === 'enter-key' ? '' : tryApiKey}
                    onChange={(e) => setTryApiKey(e.target.value || 'enter-key')}
                    placeholder="Paste your full API key (e.g. gw_live_...)"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
                  />
                  {tryApiKeys.length > 0 ? (
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      Your keys: {tryApiKeys.map((k) => (
                        <span key={k.id} style={{ display: 'inline-block', marginRight: 8, padding: '2px 8px', backgroundColor: '#f1f5f9', borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>
                          {k.name ? `${k.name} (${k.keyPrefix}...)` : `${k.keyPrefix}...`}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '8px 12px', backgroundColor: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
                      No API keys found. <a href={`/apps/${trySelectedApp}`} style={{ color: '#3b82f6' }}>Generate one</a> and paste the full key above.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ padding: '10px 12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, color: '#16a34a' }}>
                  Using your current session JWT token for authentication.
                </div>
              )}
            </div>

            {/* Request Body */}
            {routes[trySelectedRoute] && (api?.protocolType === 'SOAP' || ['POST', 'PUT', 'PATCH'].includes(routes[trySelectedRoute].method)) && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Request Body ({api?.protocolType === 'SOAP' ? 'SOAP XML' : 'JSON'})
                </label>
                {api?.protocolType === 'SOAP' && !tryBody.trim() && (() => {
                  const selectedRoute = routes[trySelectedRoute];
                  const opName = selectedRoute?.path?.replace(/^\//, '') || 'YourOperation';
                  // Extract namespace from WSDL
                  const nsMatch = specRaw?.match(/targetNamespace="([^"]+)"/);
                  const ns = nsMatch ? nsMatch[1] : 'http://example.com/webservice';
                  // Extract parameter elements for this operation from WSDL
                  // Handles any namespace prefix: <s:element>, <xs:element>, <xsd:element>, etc.
                  let params = '      <!-- Edit parameters below -->\n      <web:param>value</web:param>';
                  if (specRaw) {
                    // Match the operation's element block (any namespace prefix)
                    const opRegex = new RegExp(
                      `<\\w*:?element\\s+name="${opName}"[^>]*>[\\s\\S]*?</\\w*:?element>`,
                      'i'
                    );
                    const opBlock = specRaw.match(opRegex);
                    if (opBlock) {
                      // Find child elements with name and type attributes
                      const paramMatches = Array.from(
                        opBlock[0].matchAll(/<\w*:?element\s+name="([^"]+)"\s+type="([^"]+)"/gi)
                      );
                      if (paramMatches.length > 0) {
                        params = paramMatches
                          .map(m => {
                            const pName = m[1];
                            const pType = m[2].split(':').pop() || '';
                            const isNumeric = ['unsignedlong', 'decimal', 'int', 'integer', 'long', 'double', 'float', 'short'].includes(pType.toLowerCase());
                            return `      <web:${pName}>${isNumeric ? '42' : 'value'}</web:${pName}>`;
                          })
                          .join('\n');
                      }
                    }
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => setTryBody(
`<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:web="${ns}">
  <soap:Body>
    <web:${opName}>
${params}
    </web:${opName}>
  </soap:Body>
</soap:Envelope>`)}
                      style={{
                        marginBottom: 8, padding: '4px 10px', fontSize: 12, color: '#3b82f6',
                        border: '1px solid #bfdbfe', borderRadius: 4, backgroundColor: '#eff6ff', cursor: 'pointer',
                      }}
                    >
                      Insert SOAP envelope for {opName}
                    </button>
                  );
                })()}
                <textarea
                  value={tryBody}
                  onChange={(e) => setTryBody(e.target.value)}
                  placeholder={api?.protocolType === 'SOAP'
                    ? '<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope ...>'
                    : '{"key": "value"}'}
                  rows={api?.protocolType === 'SOAP' ? 10 : 5}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            )}

            {/* Custom Headers */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Custom Headers (optional)</label>
              <textarea
                value={tryHeaders}
                onChange={(e) => setTryHeaders(e.target.value)}
                placeholder="X-Custom-Header: value"
                rows={2}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Send Button */}
            <button
              onClick={handleTryIt}
              disabled={tryLoading || routes.length === 0}
              style={{
                width: '100%', padding: '12px 20px', backgroundColor: '#3b82f6', color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: tryLoading ? 'wait' : 'pointer',
                opacity: tryLoading ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {tryLoading ? 'Sending...' : 'Send Request'}
            </button>
          </div>

          {/* Right: Response */}
          <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 20px' }}>Response</h3>

            {tryError && (
              <div style={{ padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
                {tryError}
              </div>
            )}

            {!tryResponse && !tryError && !tryLoading && (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>{'\u{1F680}'}</div>
                <p style={{ fontSize: 14 }}>Select an endpoint and click <strong>Send Request</strong> to see the response here.</p>
              </div>
            )}

            {tryLoading && (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
                <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.6s linear infinite' }} />
                <p style={{ fontSize: 14 }}>Sending request...</p>
              </div>
            )}

            {tryResponse && (
              <div>
                {/* Subscription required hint */}
                {tryResponse.status === 403 && tryResponse.body.includes('SUBSCRIPTION_REQUIRED') && (
                  <div style={{ padding: '12px 16px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                    <strong style={{ color: '#92400e' }}>Subscription required.</strong>
                    <span style={{ color: '#78716c' }}> Your application needs an active subscription to this API. </span>
                    <button
                      onClick={() => setActiveTab('subscribe')}
                      style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, textDecoration: 'underline' }}
                    >
                      Go to Subscribe tab
                    </button>
                  </div>
                )}

                {/* Status line */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
                    backgroundColor: tryResponse.status < 300 ? '#dcfce7' : tryResponse.status < 400 ? '#fef3c7' : '#fef2f2',
                    color: tryResponse.status < 300 ? '#16a34a' : tryResponse.status < 400 ? '#d97706' : '#dc2626',
                  }}>
                    {tryResponse.status} {tryResponse.statusText}
                  </span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{tryResponse.latency}ms</span>
                </div>

                {/* Response headers */}
                <div style={{ marginBottom: 16 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      const el = (e.currentTarget.nextElementSibling as HTMLElement);
                      el.style.display = el.style.display === 'none' ? 'block' : 'none';
                    }}
                    style={{ fontSize: 12, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, padding: 0 }}
                  >
                    Toggle Headers ({Object.keys(tryResponse.headers).length})
                  </button>
                  <div style={{ display: 'none', marginTop: 8, padding: 12, backgroundColor: '#f8fafc', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }}>
                    {Object.entries(tryResponse.headers).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 4 }}>
                        <span style={{ color: '#64748b' }}>{k}:</span> <span style={{ color: '#0f172a' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Response body */}
                <pre style={{
                  padding: 16, backgroundColor: '#0f172a', color: '#e2e8f0', borderRadius: 8,
                  fontSize: 12, overflow: 'auto', lineHeight: 1.6, maxHeight: 400,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {tryResponse.body || '(empty response)'}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* API Docs Tab */}
      {activeTab === 'api-docs' && (
        <div>
          {specError ? (
            <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 48, textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: '#dc2626', marginBottom: 8 }}>{specError}</p>
              <p style={{ fontSize: 13, color: '#94a3b8' }}>The API spec for this API could not be loaded.</p>
            </div>
          ) : specRaw && !specJson ? (
            /* Non-JSON spec (WSDL, GraphQL SDL, Protobuf, etc.) — render as formatted code */
            <div style={{
              backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
              padding: '24px', minHeight: 400,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                    {api?.protocolType === 'SOAP' ? 'WSDL Definition' :
                     api?.protocolType === 'GRAPHQL' ? 'GraphQL Schema' :
                     api?.protocolType === 'GRPC' ? 'Protocol Buffer Definition' :
                     `${api?.protocolType || 'API'} Specification`}
                  </h3>
                  <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Protocol: {api?.protocolType || 'Unknown'}</p>
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(specRaw); }}
                  style={{
                    padding: '6px 14px', fontSize: 13, fontWeight: 500,
                    border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer',
                    backgroundColor: '#f8fafc', color: '#475569',
                  }}
                >
                  Copy
                </button>
              </div>

              {/* Extract and display WSDL operations */}
              {api?.protocolType === 'SOAP' && (() => {
                const ops = Array.from(specRaw.matchAll(/<(?:\w+:)?operation\s+name="([^"]+)"/g))
                  .map(m => m[1])
                  .filter((v, i, a) => a.indexOf(v) === i);
                return ops.length > 0 ? (
                  <div style={{ marginBottom: 20, padding: 16, backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, color: '#0369a1', margin: '0 0 10px' }}>
                      SOAP Operations ({ops.length})
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {ops.map(op => (
                        <span key={op} style={{
                          padding: '4px 12px', backgroundColor: '#fff', border: '1px solid #7dd3fc',
                          borderRadius: 6, fontSize: 13, fontFamily: 'monospace', color: '#0c4a6e',
                        }}>
                          {op}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              <pre style={{
                backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
                padding: 20, overflow: 'auto', maxHeight: 700, fontSize: 13,
                lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: '#334155', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {specRaw}
              </pre>
            </div>
          ) : (
            <div style={{
              backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
              padding: '16px 24px', minHeight: 400,
            }}>
              <div ref={swaggerRef} />
              {!specJson && !specRaw && (
                <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>
                  Loading API documentation...
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SDKs Tab */}
      {activeTab === 'sdks' && <SdkTab apiId={id} apiName={api.name} />}

      {/* Subscribe Tab */}
      {activeTab === 'subscribe' && (
        <div>
          {subSuccess && (
            <div style={{ padding: '12px 16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, color: '#16a34a', fontSize: 14, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{subSuccess}</span>
              <a href="/subscriptions" style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>View Subscriptions &rarr;</a>
            </div>
          )}
          {subError && (
            <div style={{ padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 14, marginBottom: 20 }}>
              {subError}
            </div>
          )}

          {!subDataLoaded ? (
            <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 48, textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: '#94a3b8' }}>Loading...</p>
            </div>
          ) : apps.length === 0 ? (
            <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 48, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>{'\u{1F4F1}'}</div>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>Create an Application First</h3>
              <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
                You need an application to subscribe to APIs. Create one to get started.
              </p>
              <a href="/apps?action=create" style={{
                display: 'inline-block', padding: '10px 24px', backgroundColor: '#3b82f6', color: '#fff',
                borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none',
              }}>
                Create Application
              </a>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Left: Subscribe / Manage Form */}
              <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 24 }}>
                {/* Current subscription status banner */}
                {isAlreadySubscribed && !subSuccess && (
                  <div style={{
                    padding: '10px 14px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
                    borderRadius: 8, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{ fontSize: 18 }}>{'\u{2705}'}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>Already subscribed</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        Current plan: <strong>{plans.find((p) => p.id === currentSubForApp?.planId)?.name || 'Unknown'}</strong>
                        {' \u00B7 '}Status: {currentSubForApp?.status}
                      </div>
                    </div>
                  </div>
                )}

                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 20px' }}>
                  {isAlreadySubscribed ? 'Change Plan' : `Subscribe to ${api.name}`}
                </h3>

                {/* Select Application */}
                <div style={{ marginBottom: 18 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Application
                  </label>
                  <select
                    value={selectedApp}
                    onChange={(e) => { setSelectedApp(e.target.value); setSubSuccess(''); setSubError(''); }}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8,
                      border: '1px solid #e2e8f0', fontSize: 14, outline: 'none',
                      backgroundColor: '#fff', color: '#0f172a',
                    }}
                  >
                    {apps.map((app) => {
                      const hasSub = existingSubs.find((s) => s.applicationId === app.id);
                      return (
                        <option key={app.id} value={app.id}>
                          {app.name}{hasSub ? ` (subscribed — ${plans.find((p) => p.id === hasSub.planId)?.name || 'plan'})` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Select Environment */}
                <div style={{ marginBottom: 18 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Environment
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[
                      { slug: 'dev', label: 'DEV', desc: 'Development — auto-approved', color: '#3b82f6', bg: '#eff6ff' },
                      { slug: 'uat', label: 'UAT', desc: 'User acceptance testing', color: '#d97706', bg: '#fffbeb' },
                      { slug: 'staging', label: 'STAGING', desc: 'Pre-production', color: '#7c3aed', bg: '#f5f3ff' },
                      { slug: 'prod', label: 'PROD', desc: 'Production — requires approval', color: '#16a34a', bg: '#f0fdf4' },
                    ].filter((env) => deployments.length === 0 || deployments.some((d) => (d.environment || d.environmentSlug) === env.slug))
                    .map((env) => (
                      <div key={env.slug} onClick={() => { setSelectedEnv(env.slug); setSubSuccess(''); setSubError(''); }}
                        style={{
                          flex: 1, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                          border: `2px solid ${selectedEnv === env.slug ? env.color : '#e2e8f0'}`,
                          backgroundColor: selectedEnv === env.slug ? env.bg : '#fff',
                          transition: 'all 0.15s', textAlign: 'center',
                        }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: selectedEnv === env.slug ? env.color : '#475569' }}>{env.label}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{env.desc}</div>
                      </div>
                    ))}
                  </div>
                  {selectedEnv === 'prod' && (
                    <p style={{ fontSize: 11, color: '#d97706', marginTop: 6 }}>
                      Production subscriptions require admin approval before keys are issued.
                    </p>
                  )}
                </div>

                {/* Select Plan */}
                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    {isAlreadySubscribed ? 'Select New Plan' : 'Plan'}
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {plans.map((plan) => {
                      const isSelected = selectedPlan === plan.id;
                      const isCurrent = isAlreadySubscribed && currentSubForApp?.planId === plan.id;
                      let rl: Record<string, string | number | boolean | null> = {};
                      let qt: Record<string, string | number | boolean | null> = {};
                      try { rl = JSON.parse(plan.rateLimits); } catch { /* */ }
                      try { qt = JSON.parse(plan.quota); } catch { /* */ }
                      return (
                        <div
                          key={plan.id}
                          onClick={() => { setSelectedPlan(plan.id); setSubSuccess(''); setSubError(''); }}
                          style={{
                            padding: '12px 16px', borderRadius: 8, cursor: 'pointer',
                            border: `2px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}`,
                            backgroundColor: isSelected ? '#eff6ff' : '#fff',
                            transition: 'all 0.15s', position: 'relative',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{plan.name}</span>
                                {isCurrent && (
                                  <span style={{
                                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                                    backgroundColor: '#dcfce7', color: '#16a34a',
                                  }}>
                                    Current
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                                {rl.requestsPerMinute ? `${rl.requestsPerMinute} req/min` : ''}
                                {rl.requestsPerMinute && qt.monthlyRequests ? ' \u00B7 ' : ''}
                                {qt.monthlyRequests ? `${Number(qt.monthlyRequests).toLocaleString()}/mo` : ''}
                                {plan.enforcement ? ` \u00B7 ${plan.enforcement}` : ''}
                              </div>
                            </div>
                            <div style={{
                              width: 18, height: 18, borderRadius: '50%',
                              border: `2px solid ${isSelected ? '#3b82f6' : '#cbd5e1'}`,
                              backgroundColor: isSelected ? '#3b82f6' : '#fff',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {isSelected && (
                                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#fff' }} />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button
                  onClick={handleSubscribe}
                  disabled={subscribing || !selectedApp || !selectedPlan || (isAlreadySubscribed && !isChangingPlan)}
                  style={{
                    width: '100%', padding: '11px 20px',
                    backgroundColor: isAlreadySubscribed && !isChangingPlan ? '#94a3b8' : isChangingPlan ? '#f59e0b' : '#3b82f6',
                    color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                    cursor: subscribing || (isAlreadySubscribed && !isChangingPlan) ? 'not-allowed' : 'pointer',
                    opacity: subscribing ? 0.7 : 1, transition: 'all 0.15s',
                  }}
                >
                  {subscribing
                    ? (isChangingPlan ? 'Changing plan...' : 'Subscribing...')
                    : isAlreadySubscribed && !isChangingPlan
                      ? 'Already on this plan'
                      : isChangingPlan
                        ? `Change to ${plans.find((p) => p.id === selectedPlan)?.name || 'plan'}`
                        : 'Subscribe Now'
                  }
                </button>

                {isChangingPlan && (
                  <p style={{ fontSize: 12, color: '#d97706', marginTop: 8, textAlign: 'center' }}>
                    This will remove your current subscription and create a new one on the selected plan.
                  </p>
                )}
              </div>

              {/* Right: API Summary + Existing Subscriptions */}
              <div>
                <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 24, marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 16px' }}>API Summary</h3>
                  {[
                    { label: 'API', value: api.name },
                    { label: 'Version', value: api.version },
                    { label: 'Protocol', value: api.protocolType || 'REST' },
                    { label: 'Auth Mode', value: api.authMode || 'ANY' },
                    { label: 'Endpoints', value: `${routes.length} route${routes.length !== 1 ? 's' : ''}` },
                    { label: 'Visibility', value: api.visibility },
                  ].map((row) => (
                    <div key={row.label} style={{
                      display: 'flex', justifyContent: 'space-between', padding: '8px 0',
                      borderBottom: '1px solid #f1f5f9', fontSize: 13,
                    }}>
                      <span style={{ color: '#94a3b8' }}>{row.label}</span>
                      <span style={{ color: '#0f172a', fontWeight: 500 }}>{row.value}</span>
                    </div>
                  ))}
                </div>

                {/* Existing Subscriptions for this API */}
                {existingSubs.length > 0 && (
                  <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 24 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: '0 0 12px' }}>
                      Active Subscriptions ({existingSubs.length})
                    </h3>
                    {existingSubs.map((sub) => {
                      const app = apps.find((a) => a.id === sub.applicationId);
                      const plan = plans.find((p) => p.id === sub.planId);
                      return (
                        <div key={sub.id} style={{
                          padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>{app?.name || sub.applicationId.substring(0, 8)}</div>
                              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                                {plan?.name || 'Unknown plan'} &middot; Since {new Date(sub.createdAt).toLocaleDateString()}
                              </div>
                            </div>
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                              backgroundColor: sub.status === 'ACTIVE' ? '#dcfce7' : '#fef3c7',
                              color: sub.status === 'ACTIVE' ? '#16a34a' : '#d97706',
                            }}>
                              {sub.status}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ marginTop: 16 }}>
                  <a href="/subscriptions" style={{ fontSize: 13, color: '#3b82f6', textDecoration: 'none', fontWeight: 500 }}>
                    View all my subscriptions &rarr;
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* SDK Tab Component                                                   */
/* ================================================================== */

const SDK_LANGUAGES = [
  { id: 'curl', name: 'cURL', icon: '>', bg: '#1e293b', color: '#fff', desc: 'Shell commands for quick API testing' },
  { id: 'postman', name: 'Postman', icon: 'PM', bg: '#ef6c00', color: '#fff', desc: 'Importable Postman collection' },
  { id: 'javascript', name: 'JavaScript', icon: 'JS', bg: '#f7df1e', color: '#1e293b', desc: 'Node.js / browser fetch client' },
  { id: 'python', name: 'Python', icon: 'PY', bg: '#3776ab', color: '#fff', desc: 'Python SDK with requests library' },
  { id: 'java', name: 'Java', icon: 'JV', bg: '#e76f00', color: '#fff', desc: 'Java SDK with HttpClient' },
  { id: 'csharp', name: 'C#', icon: 'C#', bg: '#68217a', color: '#fff', desc: '.NET SDK with HttpClient' },
  { id: 'php', name: 'PHP', icon: 'PHP', bg: '#777bb4', color: '#fff', desc: 'PHP SDK with cURL extension' },
];

function SdkTab({ apiId, apiName }: { apiId: string; apiName: string }) {
  const [generating, setGenerating] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Record<string, { downloadUrl: string; generatedAt: string }>>({});
  const [error, setError] = React.useState('');

  const handleGenerate = async (language: string) => {
    setGenerating(language);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/v1/sdks/generate/${apiId}?language=${language}`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Generation failed (${res.status})`);
      const data = await res.json();
      setResults((prev) => ({ ...prev, [language]: data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate SDK');
    } finally {
      setGenerating(null);
    }
  };

  const handleDownloadSpec = async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/governance/specs/${apiId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to download spec');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = api?.protocolType === 'SOAP' ? '.wsdl' : api?.protocolType === 'GRAPHQL' ? '.graphql' : api?.protocolType === 'GRPC' ? '.proto' : '.json';
      a.download = `${apiName.replace(/\s+/g, '-').toLowerCase()}-spec${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('API spec not available for this API');
    }
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#fff',
    borderRadius: 12,
    border: '1px solid #e2e8f0',
    padding: 24,
    marginBottom: 20,
  };

  return (
    <div>
      {error && (
        <div style={{ padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 14, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Language Cards */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 6px' }}>Download SDK</h3>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>
          Generate a client SDK for <strong>{apiName}</strong> in your preferred language
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {SDK_LANGUAGES.map((lang) => (
            <div
              key={lang.id}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                transition: 'box-shadow 0.2s',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 10,
                  backgroundColor: lang.bg,
                  color: lang.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                }}
              >
                {lang.icon}
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{lang.name}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{lang.desc}</div>
              </div>

              {results[lang.id] ? (
                <a
                  href={`${API_BASE}${results[lang.id].downloadUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 20px',
                    backgroundColor: '#10b981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: 'none',
                    cursor: 'pointer',
                    width: '100%',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  Download
                </a>
              ) : (
                <button
                  onClick={() => handleGenerate(lang.id)}
                  disabled={generating !== null}
                  style={{
                    padding: '8px 20px',
                    backgroundColor: generating === lang.id ? '#94a3b8' : '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: generating !== null ? 'not-allowed' : 'pointer',
                    width: '100%',
                  }}
                >
                  {generating === lang.id ? 'Generating...' : 'Generate'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* OpenAPI Spec Download */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 6px' }}>OpenAPI Specification</h3>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
          Download the raw API spec to use with code generators or import into tools like Swagger Editor or SoapUI
        </p>
        <button
          onClick={handleDownloadSpec}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            backgroundColor: '#f8fafc',
            color: '#334155',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
          Download OpenAPI Spec
        </button>
      </div>
    </div>
  );
}

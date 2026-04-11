'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082';

interface Route {
  id: string;
  method: string;
  path: string;
  description: string;
}

interface Plan {
  id: string;
  name: string;
  description: string;
  rateLimit: number;
  rateLimitPeriod: string;
  quotaLimit: number;
  quotaPeriod: string;
  requiresApproval: boolean;
}

interface ApiDetail {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  status: string;
  protocol: string;
  authTypes: string[];
  routes: Route[];
  plans: Plan[];
  contextPath: string;
  createdAt: string;
  updatedAt: string;
  supportedModels?: string[];
  tokenLimit?: number;
  maxTokensPerRequest?: number;
}

interface DocPage {
  id: string;
  title: string;
  type: string;
  content: string;
  order: number;
}

interface DocSearchResult {
  id: string;
  apiId: string;
  apiName: string;
  title: string;
  snippet: string;
  relevance: number;
}

type TabId = 'overview' | 'endpoints' | 'plans' | 'documentation' | 'sdks';

function getMethodClass(method: string): string {
  const m = method.toLowerCase();
  return `method-badge method-${m}`;
}

export default function ApiDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [api, setApi] = useState<ApiDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // Documentation state
  const [docPages, setDocPages] = useState<DocPage[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [docSearchResults, setDocSearchResults] = useState<DocSearchResult[]>([]);
  const [docSearching, setDocSearching] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState<Record<string, string>>({});

  // SDK state
  const [sdkGenerating, setSdkGenerating] = useState<string | null>(null);
  const [sdkContent, setSdkContent] = useState<string | null>(null);
  const [sdkLanguage, setSdkLanguage] = useState<string | null>(null);
  const [sdkCopied, setSdkCopied] = useState(false);
  const [curlCopied, setCurlCopied] = useState(false);

  useEffect(() => {
    async function fetchApi() {
      try {
        const res = await fetch(`${API_BASE}/v1/apis/${id}`);
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

  // Fetch doc pages when documentation tab is opened
  useEffect(() => {
    if (activeTab !== 'documentation' || !id) return;
    setDocLoading(true);
    fetch(`${API_BASE}/v1/docs/${id}/pages`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load docs`);
        const data = await res.json();
        setDocPages(Array.isArray(data) ? data : data.content ?? []);
      })
      .catch(() => setDocPages([]))
      .finally(() => setDocLoading(false));
  }, [activeTab, id]);

  const handleDocSearch = async () => {
    if (!docSearchQuery.trim()) return;
    setDocSearching(true);
    try {
      const res = await fetch(`${API_BASE}/v1/docs/search?q=${encodeURIComponent(docSearchQuery)}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setDocSearchResults(Array.isArray(data) ? data : data.content ?? []);
    } catch {
      setDocSearchResults([]);
    } finally {
      setDocSearching(false);
    }
  };

  const handleDocFeedback = async (pageId: string, vote: 'up' | 'down') => {
    try {
      await fetch(`${API_BASE}/v1/docs/pages/${pageId}/feedback?vote=${vote}`, { method: 'POST' });
      setFeedbackSent((prev) => ({ ...prev, [pageId]: vote }));
    } catch {
      // silently fail
    }
  };

  const handleGenerateSdk = async (language: string) => {
    setSdkGenerating(language);
    setSdkContent(null);
    setSdkLanguage(null);
    try {
      const res = await fetch(`${API_BASE}/v1/sdks/generate/${id}?language=${language}`, { method: 'POST' });
      if (!res.ok) throw new Error('SDK generation failed');
      const text = await res.text();
      setSdkContent(text);
      setSdkLanguage(language);
    } catch {
      setSdkContent('Failed to generate SDK. Please try again.');
      setSdkLanguage(language);
    } finally {
      setSdkGenerating(null);
    }
  };

  const handleDownloadSpec = () => {
    window.open(`${API_BASE}/v1/governance/specs/${id}`, '_blank');
  };

  const copySdkContent = () => {
    if (sdkContent) {
      navigator.clipboard.writeText(sdkContent);
      setSdkCopied(true);
      setTimeout(() => setSdkCopied(false), 2000);
    }
  };

  const copyCurlSample = () => {
    const gwUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080';
    const ctxPath = api?.contextPath ? `/${api.contextPath}` : '';
    const curlCmd = `curl -X GET "${gwUrl}${ctxPath}/" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Accept: application/json"`;
    navigator.clipboard.writeText(curlCmd);
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 2000);
  };

  if (loading) {
    return (
      <main className="section">
        <div className="container text-center">
          <div className="spinner" style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-primary)', width: 32, height: 32 }} />
          <p className="text-muted mt-md">Loading API details...</p>
        </div>
      </main>
    );
  }

  if (error || !api) {
    return (
      <main className="section">
        <div className="container">
          <div className="alert alert-error">{error || 'API not found'}</div>
          <a href="/catalog" className="btn btn-secondary">Back to Catalog</a>
        </div>
      </main>
    );
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'endpoints', label: 'Endpoints' },
    { id: 'plans', label: 'Plans' },
    { id: 'documentation', label: 'Documentation' },
    { id: 'sdks', label: 'SDKs' },
  ];

  const docTypeOrder = ['Getting Started', 'Tutorial', 'Reference', 'FAQ', 'Changelog'];
  const groupedDocs: Record<string, DocPage[]> = {};
  docPages.forEach((page) => {
    const type = page.type || 'Other';
    if (!groupedDocs[type]) groupedDocs[type] = [];
    groupedDocs[type].push(page);
  });
  const sortedDocTypes = Object.keys(groupedDocs).sort((a, b) => {
    const ai = docTypeOrder.indexOf(a);
    const bi = docTypeOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const sdkLanguages = [
    { key: 'curl', label: 'cURL' },
    { key: 'postman', label: 'Postman' },
    { key: 'javascript', label: 'JavaScript' },
    { key: 'python', label: 'Python' },
  ];

  return (
    <main>
      {/* Header */}
      <section style={{ padding: '48px 24px 32px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="container">
          <div className="flex gap-sm mb-sm">
            <a href="/catalog" className="text-sm text-muted" style={{ textDecoration: 'none' }}>
              Catalog
            </a>
            <span className="text-sm text-light">/</span>
            <span className="text-sm text-muted">{api.name}</span>
          </div>
          <div className="flex-between" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h1 style={{ marginBottom: 8 }}>{api.name}</h1>
              <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                <span className="badge badge-blue">{api.category || 'General'}</span>
                <span className="badge badge-green">{api.status}</span>
                <span className="badge badge-gray">v{api.version}</span>
                {api.protocol && <span className="badge badge-purple">{api.protocol}</span>}
                {api.protocol?.toUpperCase() === 'LLM' && (
                  <span className="badge badge-purple" style={{ backgroundColor: '#e9d5ff', color: '#7c3aed' }}>AI/LLM</span>
                )}
              </div>
            </div>
            <a href="/auth/login" className="btn btn-primary">
              Subscribe to API
            </a>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <section className="section" style={{ paddingTop: 32 }}>
        <div className="container">
          <div className="tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? 'tab-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div>
              <div className="card mb-lg">
                <h3 style={{ marginBottom: 12 }}>Description</h3>
                <p className="text-muted">{api.description || 'No description available.'}</p>
              </div>

              <div className="grid grid-cols-2 gap-lg">
                <div className="card">
                  <h3 style={{ marginBottom: 16 }}>Details</h3>
                  <table>
                    <tbody>
                      <tr>
                        <td className="text-muted" style={{ fontWeight: 500, width: '40%' }}>Name</td>
                        <td>{api.name}</td>
                      </tr>
                      <tr>
                        <td className="text-muted" style={{ fontWeight: 500 }}>Version</td>
                        <td>{api.version}</td>
                      </tr>
                      <tr>
                        <td className="text-muted" style={{ fontWeight: 500 }}>Protocol</td>
                        <td>{api.protocol || 'REST'}</td>
                      </tr>
                      <tr>
                        <td className="text-muted" style={{ fontWeight: 500 }}>Context Path</td>
                        <td><code>{api.contextPath || '/'}</code></td>
                      </tr>
                      <tr>
                        <td className="text-muted" style={{ fontWeight: 500 }}>Created</td>
                        <td>{api.createdAt ? new Date(api.createdAt).toLocaleDateString() : 'N/A'}</td>
                      </tr>
                      <tr>
                        <td className="text-muted" style={{ fontWeight: 500 }}>Updated</td>
                        <td>{api.updatedAt ? new Date(api.updatedAt).toLocaleDateString() : 'N/A'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="card">
                  <h3 style={{ marginBottom: 16 }}>Authentication</h3>
                  {api.authTypes && api.authTypes.length > 0 ? (
                    <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                      {api.authTypes.map((auth) => (
                        <span key={auth} className="badge badge-cyan">{auth}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted text-sm">No authentication required</p>
                  )}
                </div>
              </div>

              {/* AI/LLM Info */}
              {api.protocol?.toUpperCase() === 'LLM' && (
                <div className="card" style={{ marginTop: 24 }}>
                  <h3 style={{ marginBottom: 16 }}>
                    <span className="badge badge-purple" style={{ backgroundColor: '#e9d5ff', color: '#7c3aed', marginRight: 8 }}>AI/LLM</span>
                    AI Configuration
                  </h3>
                  <div className="grid grid-cols-2 gap-lg">
                    <div>
                      <h4 className="text-sm font-bold text-muted" style={{ marginBottom: 8 }}>Supported Models</h4>
                      {api.supportedModels && api.supportedModels.length > 0 ? (
                        <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                          {api.supportedModels.map((model) => (
                            <span key={model} className="badge badge-blue">{model}</span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted text-sm">All available models</p>
                      )}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-muted" style={{ marginBottom: 8 }}>Token Limits</h4>
                      <table>
                        <tbody>
                          {api.tokenLimit && (
                            <tr>
                              <td className="text-muted text-sm" style={{ fontWeight: 500 }}>Total Token Limit</td>
                              <td className="text-sm font-bold">{api.tokenLimit.toLocaleString()}</td>
                            </tr>
                          )}
                          {api.maxTokensPerRequest && (
                            <tr>
                              <td className="text-muted text-sm" style={{ fontWeight: 500 }}>Max Tokens / Request</td>
                              <td className="text-sm font-bold">{api.maxTokensPerRequest.toLocaleString()}</td>
                            </tr>
                          )}
                          {!api.tokenLimit && !api.maxTokensPerRequest && (
                            <tr>
                              <td className="text-muted text-sm" colSpan={2}>No token limits configured</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Endpoints Tab */}
          {activeTab === 'endpoints' && (
            <div>
              {!api.routes || api.routes.length === 0 ? (
                <div className="text-center" style={{ padding: '48px 0' }}>
                  <p className="text-muted">No endpoints documented for this API.</p>
                </div>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 100 }}>Method</th>
                        <th>Path</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {api.routes.map((route) => (
                        <tr key={route.id || `${route.method}-${route.path}`}>
                          <td>
                            <span className={getMethodClass(route.method)}>
                              {route.method.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <code style={{ fontSize: '0.875rem' }}>{route.path}</code>
                          </td>
                          <td className="text-muted text-sm">
                            {route.description || '--'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Plans Tab */}
          {activeTab === 'plans' && (
            <div>
              {!api.plans || api.plans.length === 0 ? (
                <div className="text-center" style={{ padding: '48px 0' }}>
                  <p className="text-muted">No subscription plans available for this API.</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-lg">
                  {api.plans.map((plan) => (
                    <div key={plan.id} className="card">
                      <h3 style={{ marginBottom: 8 }}>{plan.name}</h3>
                      <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
                        {plan.description || 'No description'}
                      </p>
                      <div style={{ marginBottom: 16 }}>
                        {plan.rateLimit > 0 && (
                          <div className="flex-between text-sm" style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                            <span className="text-muted">Rate Limit</span>
                            <span className="font-bold">{plan.rateLimit} req/{plan.rateLimitPeriod || 'sec'}</span>
                          </div>
                        )}
                        {plan.quotaLimit > 0 && (
                          <div className="flex-between text-sm" style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                            <span className="text-muted">Quota</span>
                            <span className="font-bold">{plan.quotaLimit.toLocaleString()} req/{plan.quotaPeriod || 'month'}</span>
                          </div>
                        )}
                        {plan.requiresApproval && (
                          <div className="flex-between text-sm" style={{ padding: '6px 0' }}>
                            <span className="text-muted">Approval</span>
                            <span className="badge badge-yellow">Required</span>
                          </div>
                        )}
                      </div>
                      <a
                        href={`/auth/login?redirect=/catalog/${id}`}
                        className="btn btn-primary btn-full"
                      >
                        Subscribe
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Documentation Tab */}
          {activeTab === 'documentation' && (
            <div>
              {/* Search */}
              <div className="card mb-lg">
                <div className="flex gap-sm" style={{ alignItems: 'center' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search documentation..."
                    value={docSearchQuery}
                    onChange={(e) => setDocSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleDocSearch(); }}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleDocSearch}
                    disabled={docSearching}
                  >
                    {docSearching ? 'Searching...' : 'Search'}
                  </button>
                </div>

                {docSearchResults.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <h4 className="text-sm font-bold text-muted" style={{ marginBottom: 8 }}>Search Results</h4>
                    {docSearchResults.map((result) => (
                      <div
                        key={result.id}
                        className="card-clickable"
                        style={{
                          padding: '12px 16px',
                          borderBottom: '1px solid var(--color-border)',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setDocSearchResults([]);
                          setDocSearchQuery('');
                          setExpandedDocId(result.id);
                        }}
                      >
                        <div className="flex-between">
                          <div>
                            <span className="font-bold" style={{ fontSize: 14 }}>{result.title}</span>
                            <span className="text-muted text-sm" style={{ marginLeft: 8 }}>{result.apiName}</span>
                          </div>
                          <span className="badge badge-blue" style={{ fontSize: 11 }}>
                            {Math.round(result.relevance * 100)}% match
                          </span>
                        </div>
                        <p className="text-muted text-sm" style={{ marginTop: 4 }}>{result.snippet}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Doc Pages by Type */}
              {docLoading ? (
                <div className="text-center" style={{ padding: '48px 0' }}>
                  <div className="spinner" style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-primary)', width: 32, height: 32 }} />
                  <p className="text-muted mt-md">Loading documentation...</p>
                </div>
              ) : docPages.length === 0 ? (
                <div className="text-center" style={{ padding: '48px 0' }}>
                  <p className="text-muted">No documentation available for this API.</p>
                </div>
              ) : (
                sortedDocTypes.map((type) => (
                  <div key={type} className="mb-lg">
                    <h3 style={{ marginBottom: 12 }}>{type}</h3>
                    {groupedDocs[type].map((page) => (
                      <div key={page.id} className="card" style={{ marginBottom: 8 }}>
                        <div
                          className="flex-between"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setExpandedDocId(expandedDocId === page.id ? null : page.id)}
                        >
                          <span className="font-bold" style={{ fontSize: 14 }}>{page.title}</span>
                          <span className="text-muted" style={{ fontSize: 18 }}>
                            {expandedDocId === page.id ? '\u2212' : '+'}
                          </span>
                        </div>
                        {expandedDocId === page.id && (
                          <div style={{ marginTop: 16 }}>
                            <div
                              className="text-sm"
                              style={{
                                lineHeight: 1.7,
                                color: 'var(--color-text)',
                                padding: '16px 0',
                                borderTop: '1px solid var(--color-border)',
                              }}
                              dangerouslySetInnerHTML={{ __html: page.content }}
                            />
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                              <span className="text-sm text-muted">Was this helpful?</span>
                              <button
                                className={`btn btn-sm ${feedbackSent[page.id] === 'up' ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => handleDocFeedback(page.id, 'up')}
                                disabled={!!feedbackSent[page.id]}
                              >
                                {'\u25B2'} Yes
                              </button>
                              <button
                                className={`btn btn-sm ${feedbackSent[page.id] === 'down' ? 'btn-danger' : 'btn-secondary'}`}
                                onClick={() => handleDocFeedback(page.id, 'down')}
                                disabled={!!feedbackSent[page.id]}
                              >
                                {'\u25BC'} No
                              </button>
                              {feedbackSent[page.id] && (
                                <span className="text-sm text-muted" style={{ marginLeft: 4 }}>Thanks for your feedback!</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}

          {/* SDKs Tab */}
          {activeTab === 'sdks' && (
            <div>
              {/* Download SDK */}
              <div className="card mb-lg">
                <h3 style={{ marginBottom: 16 }}>Download SDK</h3>
                <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
                  Generate a client SDK for this API in your preferred language.
                </p>
                <div className="flex gap-sm" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
                  {sdkLanguages.map((lang) => (
                    <button
                      key={lang.key}
                      className={`btn ${sdkLanguage === lang.key ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleGenerateSdk(lang.key)}
                      disabled={sdkGenerating === lang.key}
                    >
                      {sdkGenerating === lang.key ? 'Generating...' : lang.label}
                    </button>
                  ))}
                </div>

                {sdkContent && sdkLanguage && (
                  <div style={{ marginTop: 12 }}>
                    <div className="flex-between" style={{ marginBottom: 8 }}>
                      <span className="font-bold text-sm">
                        Generated {sdkLanguages.find((l) => l.key === sdkLanguage)?.label} SDK
                      </span>
                      <button
                        className={`btn btn-sm ${sdkCopied ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={copySdkContent}
                      >
                        {sdkCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre
                      style={{
                        padding: 16,
                        backgroundColor: '#1e293b',
                        color: '#e2e8f0',
                        borderRadius: 'var(--radius)',
                        fontSize: '0.8125rem',
                        overflow: 'auto',
                        maxHeight: 400,
                        lineHeight: 1.6,
                      }}
                    >
                      {sdkContent}
                    </pre>
                  </div>
                )}
              </div>

              {/* OpenAPI Spec & cURL */}
              <div className="grid grid-cols-2 gap-lg">
                <div className="card">
                  <h3 style={{ marginBottom: 8 }}>OpenAPI Spec</h3>
                  <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
                    Download the OpenAPI specification for this API.
                  </p>
                  <button className="btn btn-primary btn-full" onClick={handleDownloadSpec}>
                    Download OpenAPI Spec
                  </button>
                </div>

                <div className="card">
                  <h3 style={{ marginBottom: 8 }}>Sample cURL</h3>
                  <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
                    Copy a sample cURL command to test this API.
                  </p>
                  <button
                    className={`btn btn-full ${curlCopied ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={copyCurlSample}
                  >
                    {curlCopied ? 'Copied!' : 'Copy cURL'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

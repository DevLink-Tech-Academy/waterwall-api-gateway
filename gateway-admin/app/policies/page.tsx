'use client';

import { useEffect, useState, useCallback } from 'react';
import TransformationBuilder from '../components/TransformationBuilder';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082';

interface Policy {
  id: string;
  name: string;
  type: string;
  description?: string;
  config?: string;
  createdAt?: string;
}

interface PolicyAttachment {
  id: string;
  policyId: string;
  policyName?: string;
  apiId: string;
  apiName?: string;
  scope: string;
  priority: number;
}

interface ApiOption {
  id: string;
  name: string;
}

const POLICY_TYPES = ['RATE_LIMIT', 'AUTH', 'TRANSFORM', 'CACHE', 'CORS', 'IP_FILTER'] as const;

function getToken(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('admin_token') || '';
  }
  return '';
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

function getTypeBadgeClasses(type: string): string {
  switch (type?.toUpperCase()) {
    case 'RATE_LIMIT':
      return 'bg-amber-100 text-amber-800 ring-1 ring-amber-300';
    case 'AUTH':
      return 'bg-blue-100 text-blue-800 ring-1 ring-blue-300';
    case 'TRANSFORM':
      return 'bg-purple-100 text-purple-800 ring-1 ring-purple-300';
    case 'CACHE':
      return 'bg-cyan-100 text-cyan-800 ring-1 ring-cyan-300';
    case 'CORS':
      return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300';
    case 'IP_FILTER':
      return 'bg-red-100 text-red-800 ring-1 ring-red-300';
    default:
      return 'bg-gray-100 text-gray-800 ring-1 ring-gray-300';
  }
}

function getScopeBadgeClasses(scope: string): string {
  switch (scope?.toUpperCase()) {
    case 'GLOBAL':
      return 'bg-indigo-100 text-indigo-800 ring-1 ring-indigo-300';
    case 'API':
      return 'bg-blue-100 text-blue-800 ring-1 ring-blue-300';
    case 'ROUTE':
      return 'bg-teal-100 text-teal-800 ring-1 ring-teal-300';
    default:
      return 'bg-gray-100 text-gray-800 ring-1 ring-gray-300';
  }
}

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [attachments, setAttachments] = useState<PolicyAttachment[]>([]);
  const [apis, setApis] = useState<ApiOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /* Create policy modal */
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    type: 'RATE_LIMIT' as string,
    description: '',
    config: '{}',
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  /* View/Edit policy modal */
  const [viewingPolicy, setViewingPolicy] = useState<Policy | null>(null);
  const [editForm, setEditForm] = useState({ name: '', type: '', description: '', config: '{}' });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  /* Attach policy modal */
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [attachForm, setAttachForm] = useState({
    policyId: '',
    apiId: '',
    scope: 'API',
    priority: 0,
  });
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachError, setAttachError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [polRes, attRes, apiRes] = await Promise.all([
        fetch(`${API_URL}/v1/policies`, { headers: authHeaders() }),
        fetch(`${API_URL}/v1/policies/attachments`, { headers: authHeaders() }),
        fetch(`${API_URL}/v1/apis`, { headers: authHeaders() }),
      ]);
      if (polRes.ok) {
        const data = await polRes.json();
        setPolicies(Array.isArray(data) ? data : data.content || data.data || []);
      }
      if (attRes.ok) {
        const data = await attRes.json();
        setAttachments(Array.isArray(data) ? data : data.content || data.data || []);
      }
      if (apiRes.ok) {
        const data = await apiRes.json();
        const list = Array.isArray(data) ? data : data.content || data.data || [];
        setApis(list.map((a: ApiOption) => ({ id: a.id, name: a.name })));
      }
    } catch {
      setError('Failed to load policy data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError('');
    try {
      const res = await fetch(`${API_URL}/v1/policies`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: createForm.name,
          type: createForm.type,
          description: createForm.description,
          config: createForm.config,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to create policy');
      }
      setShowCreateModal(false);
      setCreateForm({ name: '', type: 'RATE_LIMIT', description: '', config: '{}' });
      fetchData();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create policy');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleAttachPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttachLoading(true);
    setAttachError('');
    try {
      const res = await fetch(`${API_URL}/v1/policies/attachments`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          policyId: attachForm.policyId,
          apiId: attachForm.apiId,
          scope: attachForm.scope,
          priority: attachForm.priority,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to attach policy');
      }
      setShowAttachModal(false);
      setAttachForm({ policyId: '', apiId: '', scope: 'API', priority: 0 });
      fetchData();
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Failed to attach policy');
    } finally {
      setAttachLoading(false);
    }
  };

  const handleViewPolicy = async (policy: Policy) => {
    setViewingPolicy(policy);
    setEditForm({
      name: policy.name,
      type: policy.type,
      description: policy.description || '',
      config: policy.config || '{}',
    });
    setEditError('');
  };

  const handleUpdatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewingPolicy) return;
    setEditLoading(true);
    setEditError('');
    try {
      const res = await fetch(`${API_URL}/v1/policies/${viewingPolicy.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          name: editForm.name,
          type: editForm.type,
          description: editForm.description,
          config: editForm.config,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to update policy');
      }
      setViewingPolicy(null);
      fetchData();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update policy');
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeletePolicy = async (id: string, name: string) => {
    if (!confirm(`Delete policy "${name}"? This will also remove all its attachments.`)) return;
    try {
      const res = await fetch(`${API_URL}/v1/policies/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete policy');
      fetchData();
    } catch {
      setError('Failed to delete policy');
    }
  };

  /* Loading skeleton */
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Header skeleton */}
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-200" />
              <div className="h-4 w-72 animate-pulse rounded bg-gray-200" />
            </div>
            <div className="flex gap-3">
              <div className="h-10 w-32 animate-pulse rounded-lg bg-gray-200" />
              <div className="h-10 w-32 animate-pulse rounded-lg bg-gray-200" />
            </div>
          </div>
          {/* Card skeletons */}
          {[1, 2].map((i) => (
            <div key={i} className="rounded-xl bg-white p-6 shadow-sm">
              <div className="mb-4 h-6 w-40 animate-pulse rounded bg-gray-200" />
              <div className="space-y-3">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="h-12 w-full animate-pulse rounded bg-gray-100" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Policies</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage gateway policies and their attachments to APIs
            </p>
          </div>
          <div className="flex gap-3">
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              onClick={() => setShowAttachModal(true)}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
              </svg>
              Attach Policy
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              onClick={() => setShowCreateModal(true)}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create Policy
            </button>
          </div>
        </div>

        {/* Error alert */}
        {error && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <svg className="h-5 w-5 shrink-0 text-red-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        )}

        {/* Section 1: Policy Library */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Policy Library</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              All configured gateway policies
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Name</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Type</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Description</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Created</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {policies.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <svg className="h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.251 2.251 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                        </svg>
                        <p className="text-sm font-medium text-gray-400">No policies found</p>
                        <p className="text-xs text-gray-400">Create your first policy to get started</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  policies.map((p) => (
                    <tr key={p.id} className="transition hover:bg-gray-50/80">
                      <td className="whitespace-nowrap px-6 py-4 font-medium text-gray-900">{p.name}</td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getTypeBadgeClasses(p.type)}`}>
                          {p.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-500">{p.description || '\u2014'}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-gray-500">
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '\u2014'}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleViewPolicy(p)}
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 ring-1 ring-indigo-200"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                            </svg>
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeletePolicy(p.id, p.name)}
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 ring-1 ring-red-200"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 2: Policy Attachments */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Policy Attachments</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Policies linked to specific APIs
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Policy</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">API</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Scope</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Priority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {attachments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <svg className="h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        <p className="text-sm font-medium text-gray-400">No attachments found</p>
                        <p className="text-xs text-gray-400">Attach a policy to an API to enforce it</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  attachments.map((att) => (
                    <tr key={att.id} className="transition hover:bg-gray-50/80">
                      <td className="whitespace-nowrap px-6 py-4 font-medium text-gray-900">
                        {att.policyName || att.policyId}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-gray-700">
                        {att.apiName || att.apiId}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getScopeBadgeClasses(att.scope)}`}>
                          {att.scope}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-gray-500">{att.priority}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Policy Modal */}
        {showCreateModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setShowCreateModal(false)}
          >
            <div
              className={`mx-4 w-full rounded-2xl bg-white p-0 shadow-2xl ring-1 ring-gray-200 ${createForm.type === 'TRANSFORM' ? 'max-w-2xl' : 'max-w-lg'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Create Policy</h3>
                  <p className="mt-0.5 text-sm text-gray-500">Define a new gateway policy</p>
                </div>
                <button
                  className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                  onClick={() => setShowCreateModal(false)}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleCreatePolicy} className="space-y-5 px-6 py-5">
                {createError && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    <svg className="h-4 w-4 shrink-0 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                    </svg>
                    {createError}
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Name</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Rate Limit - Standard"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Type</label>
                  <select
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    value={createForm.type}
                    onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}
                  >
                    {POLICY_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Optional description"
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Configuration</label>
                  {createForm.type === 'TRANSFORM' ? (
                    <TransformationBuilder
                      value={createForm.config}
                      onChange={(json) => setCreateForm({ ...createForm, config: json })}
                      apiUrl={API_URL}
                    />
                  ) : (
                    <textarea
                      className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 font-mono text-sm text-gray-900 shadow-sm placeholder:text-gray-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      rows={6}
                      placeholder='{"limit": 100, "window": "1m"}'
                      value={createForm.config}
                      onChange={(e) => setCreateForm({ ...createForm, config: e.target.value })}
                    />
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-5">
                  <button
                    type="button"
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={createLoading}
                  >
                    {createLoading && (
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {createLoading ? 'Creating...' : 'Create Policy'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Attach Policy Modal */}
        {showAttachModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setShowAttachModal(false)}
          >
            <div
              className="mx-4 w-full max-w-lg rounded-2xl bg-white p-0 shadow-2xl ring-1 ring-gray-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Attach Policy</h3>
                  <p className="mt-0.5 text-sm text-gray-500">Link a policy to an API</p>
                </div>
                <button
                  className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                  onClick={() => setShowAttachModal(false)}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleAttachPolicy} className="space-y-5 px-6 py-5">
                {attachError && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    <svg className="h-4 w-4 shrink-0 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                    </svg>
                    {attachError}
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Policy</label>
                  <select
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    value={attachForm.policyId}
                    onChange={(e) => setAttachForm({ ...attachForm, policyId: e.target.value })}
                    required
                  >
                    <option value="">Select Policy...</option>
                    {policies.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">API</label>
                  <select
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    value={attachForm.apiId}
                    onChange={(e) => setAttachForm({ ...attachForm, apiId: e.target.value })}
                    required
                  >
                    <option value="">Select API...</option>
                    {apis.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Scope</label>
                  <select
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    value={attachForm.scope}
                    onChange={(e) => setAttachForm({ ...attachForm, scope: e.target.value })}
                  >
                    <option value="GLOBAL">GLOBAL</option>
                    <option value="API">API</option>
                    <option value="ROUTE">ROUTE</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Priority</label>
                  <input
                    type="number"
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    value={attachForm.priority}
                    onChange={(e) => setAttachForm({ ...attachForm, priority: parseInt(e.target.value) || 0 })}
                    min={0}
                  />
                  <p className="mt-1.5 text-xs text-gray-500">Lower number = higher priority</p>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-5">
                  <button
                    type="button"
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
                    onClick={() => setShowAttachModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={attachLoading}
                  >
                    {attachLoading && (
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {attachLoading ? 'Attaching...' : 'Attach Policy'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* View/Edit Policy Modal */}
        {viewingPolicy && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setViewingPolicy(null)}
          >
            <div
              className={`mx-4 w-full max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-0 shadow-2xl ring-1 ring-gray-200 ${editForm.type === 'TRANSFORM' ? 'max-w-3xl' : 'max-w-lg'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Edit Policy</h3>
                  <p className="mt-0.5 text-sm text-gray-500">Update policy configuration</p>
                </div>
                <button
                  className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                  onClick={() => setViewingPolicy(null)}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleUpdatePolicy} className="space-y-5 px-6 py-5">
                {editError && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    <svg className="h-4 w-4 shrink-0 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                    </svg>
                    {editError}
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Name</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Type</label>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getTypeBadgeClasses(editForm.type)}`}>
                      {editForm.type}
                    </span>
                    <span className="text-xs text-gray-400">Type cannot be changed after creation</span>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Configuration</label>
                  {editForm.type === 'TRANSFORM' ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                      <TransformationBuilder
                        value={editForm.config}
                        onChange={(json: string) => setEditForm({ ...editForm, config: json })}
                        apiUrl={API_URL}
                      />
                    </div>
                  ) : (
                    <textarea
                      className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 font-mono text-sm text-gray-900 shadow-sm placeholder:text-gray-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      rows={8}
                      value={editForm.config}
                      onChange={(e) => setEditForm({ ...editForm, config: e.target.value })}
                    />
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-5">
                  <button
                    type="button"
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
                    onClick={() => setViewingPolicy(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={editLoading}
                  >
                    {editLoading && (
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {editLoading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import { post } from '@gateway/shared-ui';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PROTOCOLS = ['REST', 'SOAP', 'GraphQL', 'gRPC', 'WebSocket', 'SSE', 'JSON-RPC', 'OData'] as const;
const VISIBILITIES = ['PUBLIC', 'PRIVATE', 'RESTRICTED'] as const;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CreateApiPayload {
  name: string;
  version: string;
  description: string;
  protocol: string;
  visibility: string;
  category: string;
  tags: string[];
  backendBaseUrl?: string;
  contextPath?: string;
}

interface CreatedApi {
  id: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Field wrapper (defined outside component to avoid remount)         */
/* ------------------------------------------------------------------ */

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CreateApiPage() {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [protocol, setProtocol] = useState<string>('REST');
  const [visibility, setVisibility] = useState<string>('PUBLIC');
  const [category, setCategory] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [backendBaseUrl, setBackendBaseUrl] = useState('');
  const [contextPath, setContextPath] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);

    const payload: CreateApiPayload = {
      name: name.trim(),
      version: version.trim() || '1.0.0',
      description: description.trim(),
      protocol,
      visibility,
      category: category.trim(),
      backendBaseUrl: backendBaseUrl.trim() || undefined,
      contextPath: contextPath.trim() || undefined,
      tags: tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };

    try {
      const created = await post<CreatedApi>('/v1/apis', payload);
      window.location.href = `/apis/${created.id}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create API';
      setError(message);
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <button
        onClick={() => { window.location.href = '/apis'; }}
        className="text-sm text-blue-600 hover:underline mb-4 inline-block"
      >
        &larr; Back to APIs
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create New API</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-6">
        <Field label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); if (!contextPath) setContextPath(generateSlug(e.target.value)); }}
            required
            className={inputCls}
            placeholder="My API"
          />
        </Field>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Context Path <span className="text-xs text-slate-400">(auto-generated, editable)</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">/</span>
            <input
              type="text"
              value={contextPath}
              onChange={(e) => setContextPath(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="e.g. my-api"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Gateway URL: /{contextPath || 'context-path'}/{'{version}'}/...
          </p>
        </div>

        <Field label="Version">
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className={inputCls}
            placeholder="1.0.0"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={inputCls}
            placeholder="Brief description of the API..."
          />
        </Field>

        <Field label="Protocol">
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
            className={inputCls}
          >
            {PROTOCOLS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>

        <Field label="Visibility">
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className={inputCls}
          >
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Field>

        <Field label="Category">
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputCls}
            placeholder="e.g. Finance, Analytics"
          />
        </Field>

        <Field label="Tags (comma-separated)">
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            className={inputCls}
            placeholder="e.g. payments, internal, v2"
          />
        </Field>

        <Field label="Backend Base URL">
          <input
            type="url"
            value={backendBaseUrl}
            onChange={(e) => setBackendBaseUrl(e.target.value)}
            className={inputCls}
            placeholder="https://api.example.com/v1"
          />
          <p className="text-xs text-gray-400 mt-1">
            The upstream server URL. All route paths will be appended to this base URL.
          </p>
        </Field>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={() => { window.location.href = '/apis'; }}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating...' : 'Create API'}
          </button>
        </div>
      </form>
    </main>
  );
}

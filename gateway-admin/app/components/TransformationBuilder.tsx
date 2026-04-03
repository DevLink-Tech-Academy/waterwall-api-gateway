'use client';

import { useState, useEffect } from 'react';

// ── Types ────────────────────────────────────────────────────────────

interface HeaderRule {
  action: 'add' | 'remove' | 'rename' | 'override';
  name: string;
  value?: string;
  newName?: string;
}

interface BodyMappingRule {
  source: string;
  target: string;
}

interface QueryParamRule {
  action: 'add' | 'remove' | 'rename';
  name: string;
  value?: string;
  newName?: string;
}

interface UrlRewriteRule {
  pattern: string;
  replacement: string;
}

interface RequestTransform {
  headers?: HeaderRule[];
  body?: BodyMappingRule[];
  queryParams?: QueryParamRule[];
  urlRewrite?: UrlRewriteRule;
}

interface ResponseTransform {
  headers?: HeaderRule[];
  body?: BodyMappingRule[];
}

interface TransformConfig {
  request?: RequestTransform;
  response?: ResponseTransform;
}

interface TransformTemplate {
  name: string;
  description: string;
  category: string;
  config: TransformConfig;
}

interface TransformationBuilderProps {
  value: string; // JSON string
  onChange: (json: string) => void;
  apiUrl: string;
}

// ── Sub-components ───────────────────────────────────────────────────

function HeaderRulesEditor({
  rules,
  onChange,
  label,
}: {
  rules: HeaderRule[];
  onChange: (rules: HeaderRule[]) => void;
  label: string;
}) {
  const addRule = () => onChange([...rules, { action: 'add', name: '', value: '' }]);
  const removeRule = (i: number) => onChange(rules.filter((_, idx) => idx !== i));
  const updateRule = (i: number, field: string, val: string) => {
    const updated = [...rules];
    updated[i] = { ...updated[i], [field]: val };
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">{label}</h4>
        <button
          type="button"
          onClick={addRule}
          className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-200"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Rule
        </button>
      </div>
      {rules.length === 0 && (
        <p className="text-xs text-gray-400 italic">No header rules configured</p>
      )}
      {rules.map((rule, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
          <select
            className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={rule.action}
            onChange={(e) => updateRule(i, 'action', e.target.value)}
          >
            <option value="add">Add</option>
            <option value="override">Override</option>
            <option value="remove">Remove</option>
            <option value="rename">Rename</option>
          </select>
          <input
            className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Header name"
            value={rule.name}
            onChange={(e) => updateRule(i, 'name', e.target.value)}
          />
          {(rule.action === 'add' || rule.action === 'override') && (
            <input
              className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Value"
              value={rule.value || ''}
              onChange={(e) => updateRule(i, 'value', e.target.value)}
            />
          )}
          {rule.action === 'rename' && (
            <input
              className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="New name"
              value={rule.newName || ''}
              onChange={(e) => updateRule(i, 'newName', e.target.value)}
            />
          )}
          <button
            type="button"
            onClick={() => removeRule(i)}
            className="rounded-md p-1 text-gray-400 transition hover:bg-red-50 hover:text-red-500"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function BodyMappingEditor({
  rules,
  onChange,
  label,
}: {
  rules: BodyMappingRule[];
  onChange: (rules: BodyMappingRule[]) => void;
  label: string;
}) {
  const addRule = () => onChange([...rules, { source: '', target: '' }]);
  const removeRule = (i: number) => onChange(rules.filter((_, idx) => idx !== i));
  const updateRule = (i: number, field: string, val: string) => {
    const updated = [...rules];
    updated[i] = { ...updated[i], [field]: val };
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">{label}</h4>
        <button
          type="button"
          onClick={addRule}
          className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-200"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Mapping
        </button>
      </div>
      {rules.length === 0 && (
        <p className="text-xs text-gray-400 italic">No body mapping rules configured</p>
      )}
      {rules.map((rule, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
          <input
            className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs font-mono placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="source.field.path"
            value={rule.source}
            onChange={(e) => updateRule(i, 'source', e.target.value)}
          />
          <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
          <input
            className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs font-mono placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="target.field.path"
            value={rule.target}
            onChange={(e) => updateRule(i, 'target', e.target.value)}
          />
          <button
            type="button"
            onClick={() => removeRule(i)}
            className="rounded-md p-1 text-gray-400 transition hover:bg-red-50 hover:text-red-500"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function QueryParamEditor({
  rules,
  onChange,
}: {
  rules: QueryParamRule[];
  onChange: (rules: QueryParamRule[]) => void;
}) {
  const addRule = () => onChange([...rules, { action: 'add', name: '', value: '' }]);
  const removeRule = (i: number) => onChange(rules.filter((_, idx) => idx !== i));
  const updateRule = (i: number, field: string, val: string) => {
    const updated = [...rules];
    updated[i] = { ...updated[i], [field]: val };
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">Query Parameters</h4>
        <button
          type="button"
          onClick={addRule}
          className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-200"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Rule
        </button>
      </div>
      {rules.length === 0 && (
        <p className="text-xs text-gray-400 italic">No query parameter rules configured</p>
      )}
      {rules.map((rule, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
          <select
            className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={rule.action}
            onChange={(e) => updateRule(i, 'action', e.target.value)}
          >
            <option value="add">Add</option>
            <option value="remove">Remove</option>
            <option value="rename">Rename</option>
          </select>
          <input
            className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Param name"
            value={rule.name}
            onChange={(e) => updateRule(i, 'name', e.target.value)}
          />
          {rule.action === 'add' && (
            <input
              className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Value"
              value={rule.value || ''}
              onChange={(e) => updateRule(i, 'value', e.target.value)}
            />
          )}
          {rule.action === 'rename' && (
            <input
              className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="New name"
              value={rule.newName || ''}
              onChange={(e) => updateRule(i, 'newName', e.target.value)}
            />
          )}
          <button
            type="button"
            onClick={() => removeRule(i)}
            className="rounded-md p-1 text-gray-400 transition hover:bg-red-50 hover:text-red-500"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function UrlRewriteEditor({
  rule,
  onChange,
}: {
  rule: UrlRewriteRule | undefined;
  onChange: (rule: UrlRewriteRule | undefined) => void;
}) {
  const enabled = !!rule;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">URL Rewrite</h4>
        <button
          type="button"
          onClick={() => onChange(enabled ? undefined : { pattern: '', replacement: '' })}
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
            enabled
              ? 'bg-red-50 text-red-600 hover:bg-red-100'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {enabled ? 'Remove' : 'Enable'}
        </button>
      </div>
      {enabled && rule && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Regex Pattern</label>
            <input
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs font-mono placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="/api/v1/(.*)"
              value={rule.pattern}
              onChange={(e) => onChange({ ...rule, pattern: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Replacement</label>
            <input
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs font-mono placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="/api/v2/$1"
              value={rule.replacement}
              onChange={(e) => onChange({ ...rule, replacement: e.target.value })}
            />
          </div>
          <p className="text-xs text-gray-400">Use $1, $2, etc. for capture group references</p>
        </div>
      )}
      {!enabled && (
        <p className="text-xs text-gray-400 italic">URL rewriting is disabled</p>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export default function TransformationBuilder({ value, onChange, apiUrl }: TransformationBuilderProps) {
  const [activeTab, setActiveTab] = useState<'request' | 'response'>('request');
  const [templates, setTemplates] = useState<TransformTemplate[]>([]);
  const [config, setConfig] = useState<TransformConfig>(() => {
    try {
      return JSON.parse(value || '{}');
    } catch {
      return {};
    }
  });

  // Load templates
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : '';
    fetch(`${apiUrl}/v1/policies/templates`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [apiUrl]);

  // Sync changes to parent
  const updateConfig = (newConfig: TransformConfig) => {
    // Clean up empty arrays/objects
    const cleaned: TransformConfig = {};
    if (newConfig.request) {
      const req: RequestTransform = {};
      if (newConfig.request.headers?.length) req.headers = newConfig.request.headers;
      if (newConfig.request.body?.length) req.body = newConfig.request.body;
      if (newConfig.request.queryParams?.length) req.queryParams = newConfig.request.queryParams;
      if (newConfig.request.urlRewrite) req.urlRewrite = newConfig.request.urlRewrite;
      if (Object.keys(req).length > 0) cleaned.request = req;
    }
    if (newConfig.response) {
      const resp: ResponseTransform = {};
      if (newConfig.response.headers?.length) resp.headers = newConfig.response.headers;
      if (newConfig.response.body?.length) resp.body = newConfig.response.body;
      if (Object.keys(resp).length > 0) cleaned.response = resp;
    }
    setConfig(newConfig);
    onChange(JSON.stringify(cleaned));
  };

  const applyTemplate = (template: TransformTemplate) => {
    const newConfig = template.config as TransformConfig;
    setConfig(newConfig);
    onChange(JSON.stringify(newConfig));
  };

  const reqHeaders = config.request?.headers || [];
  const reqBody = config.request?.body || [];
  const reqParams = config.request?.queryParams || [];
  const reqUrlRewrite = config.request?.urlRewrite;
  const resHeaders = config.response?.headers || [];
  const resBody = config.response?.body || [];

  // Count rules per tab
  const requestCount = reqHeaders.length + reqBody.length + reqParams.length + (reqUrlRewrite ? 1 : 0);
  const responseCount = resHeaders.length + resBody.length;

  return (
    <div className="space-y-4">
      {/* Template selector */}
      {templates.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-600">Start from template</label>
          <select
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            defaultValue=""
            onChange={(e) => {
              const t = templates.find((t) => t.name === e.target.value);
              if (t) applyTemplate(t);
            }}
          >
            <option value="" disabled>Select a template...</option>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} — {t.description}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          type="button"
          onClick={() => setActiveTab('request')}
          className={`relative px-4 py-2.5 text-sm font-medium transition ${
            activeTab === 'request'
              ? 'text-indigo-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Request
          {requestCount > 0 && (
            <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600">
              {requestCount}
            </span>
          )}
          {activeTab === 'request' && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-indigo-600" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('response')}
          className={`relative px-4 py-2.5 text-sm font-medium transition ${
            activeTab === 'response'
              ? 'text-indigo-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Response
          {responseCount > 0 && (
            <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-purple-100 text-xs font-semibold text-purple-600">
              {responseCount}
            </span>
          )}
          {activeTab === 'response' && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-indigo-600" />
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="space-y-5">
        {activeTab === 'request' && (
          <>
            <HeaderRulesEditor
              label="Request Headers"
              rules={reqHeaders}
              onChange={(headers) =>
                updateConfig({ ...config, request: { ...config.request, headers } })
              }
            />
            <BodyMappingEditor
              label="Request Body Field Mapping"
              rules={reqBody}
              onChange={(body) =>
                updateConfig({ ...config, request: { ...config.request, body } })
              }
            />
            <QueryParamEditor
              rules={reqParams}
              onChange={(queryParams) =>
                updateConfig({ ...config, request: { ...config.request, queryParams } })
              }
            />
            <UrlRewriteEditor
              rule={reqUrlRewrite}
              onChange={(urlRewrite) =>
                updateConfig({ ...config, request: { ...config.request, urlRewrite } })
              }
            />
          </>
        )}
        {activeTab === 'response' && (
          <>
            <HeaderRulesEditor
              label="Response Headers"
              rules={resHeaders}
              onChange={(headers) =>
                updateConfig({ ...config, response: { ...config.response, headers } })
              }
            />
            <BodyMappingEditor
              label="Response Body Field Mapping"
              rules={resBody}
              onChange={(body) =>
                updateConfig({ ...config, response: { ...config.response, body } })
              }
            />
          </>
        )}
      </div>

      {/* JSON Preview */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-gray-500 transition hover:text-gray-700">
          View JSON config
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs font-mono text-gray-600">
          {JSON.stringify(config, null, 2)}
        </pre>
      </details>
    </div>
  );
}

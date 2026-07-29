// Resolve config at call-time from runtime env (window.__ENV, injected by the
// container entrypoint into /public/__env.js) with a fall-back to the
// build-time NEXT_PUBLIC_* value. This mirrors auth.ts's cfg() so the same
// standalone image can be pointed at different backends per deployment —
// otherwise Next.js bakes NEXT_PUBLIC_* at build time and they can't change.
function cfg(key: string, fallback = ''): string {
  if (typeof window !== 'undefined') {
    const env = (window as unknown as { __ENV?: Record<string, string> }).__ENV;
    if (env && env[key]) return env[key];
  }
  const fromProcess = (process.env as Record<string, string | undefined>)[key];
  return fromProcess || fallback;
}

const apiBase = () => cfg('NEXT_PUBLIC_API_URL', 'http://localhost:8082');
const identityBase = () => cfg('NEXT_PUBLIC_IDENTITY_URL', 'http://localhost:8081');

// Paths that live on the identity-service, not management-api
const IDENTITY_PATHS = ['/v1/applications', '/v1/users', '/v1/auth', '/v1/mfa', '/v1/orgs'];

// ─── Error types ─────────────────────────────────────────────
export interface ApiErrorResponse {
  status: number;
  message: string;
  errors?: Record<string, string[]>;
}

export class ApiError extends Error {
  status: number;
  errors?: Record<string, string[]>;

  constructor(response: ApiErrorResponse) {
    super(response.message);
    this.name = 'ApiError';
    this.status = response.status;
    this.errors = response.errors;
  }
}

// ─── Token helper ────────────────────────────────────────────
function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token')
    || localStorage.getItem('admin_token')
    || localStorage.getItem('jwt_token');
}

// ─── Base request ────────────────────────────────────────────
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const base = IDENTITY_PATHS.some(p => path.startsWith(p)) ? identityBase() : apiBase();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    // Handle 401 — token expired or invalid, redirect to login
    if (res.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('admin_token');
      localStorage.removeItem('jwt_token');
      localStorage.removeItem('user');
      document.cookie = 'token=; path=/; max-age=0';
      document.cookie = 'admin_token=; path=/; max-age=0';
      // Determine which portal we're in
      const isAdmin = window.location.port === '3001' || window.location.pathname.startsWith('/admin');
      const loginPath = isAdmin ? '/auth/login' : '/auth/login';
      window.location.href = `${loginPath}?expired=true`;
      // Return a never-resolving promise so the caller doesn't continue
      return new Promise<T>(() => {});
    }

    // Handle 403 — user doesn't have permission
    if (res.status === 403) {
      let errorBody: ApiErrorResponse;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = { status: 403, message: 'Access denied' };
      }
      const message = errorBody.message || 'You do not have permission to perform this action. Please contact your administrator.';
      throw new ApiError({ status: 403, message, errors: errorBody.errors });
    }

    let errorBody: ApiErrorResponse;
    try {
      errorBody = await res.json();
    } catch {
      errorBody = { status: res.status, message: res.statusText };
    }
    throw new ApiError({ status: res.status, message: errorBody.message, errors: errorBody.errors });
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json();
}

// ─── HTTP methods ────────────────────────────────────────────
export function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function del(path: string): Promise<void> {
  return request<void>(path, { method: 'DELETE' });
}

// ─── Paginated response type ────────────────────────────────
export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

// ─── Domain types ────────────────────────────────────────────
export interface ApiDefinition {
  id: string;
  name: string;
  version: string;
  status: string;
  description?: string;
  basePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface Application {
  id: string;
  name: string;
  description?: string;
  status: string;
  ownerId: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  applicationId: string;
  status: string;
  createdAt: string;
  expiresAt?: string;
}

export interface Subscription {
  id: string;
  applicationId: string;
  apiId: string;
  planId: string;
  status: string;
  createdAt: string;
}

// ─── Typed API functions ─────────────────────────────────────

// APIs
export function fetchApis(page = 0, size = 20) {
  return get<PageResponse<ApiDefinition>>(`/v1/apis?page=${page}&size=${size}`);
}

export function fetchApi(id: string) {
  return get<ApiDefinition>(`/v1/apis/${id}`);
}

// Applications
export function createApp(data: { name: string; description?: string }) {
  return post<Application>('/v1/applications', data);
}

export function listMyApps(page = 0, size = 20) {
  return get<PageResponse<Application>>(`/v1/applications/me?page=${page}&size=${size}`);
}

// API Keys
export function generateApiKey(applicationId: string, name: string) {
  return post<ApiKey>(`/v1/applications/${applicationId}/keys`, { name });
}

export function listApiKeys(applicationId: string) {
  return get<ApiKey[]>(`/v1/applications/${applicationId}/keys`);
}

export function revokeApiKey(applicationId: string, keyId: string) {
  return del(`/v1/applications/${applicationId}/keys/${keyId}`);
}

// Subscriptions
export function subscribe(data: { applicationId: string; apiId: string; planId: string }) {
  return post<Subscription>('/v1/subscriptions', data);
}

export function listSubscriptions(applicationId: string) {
  return get<Subscription[]>(`/v1/subscriptions?applicationId=${applicationId}`);
}

// Re-export the legacy apiClient for backward compatibility
export async function apiClient<T>(path: string, options?: RequestInit): Promise<T> {
  return request<T>(path, options);
}

// ─── Global 401 handler for pages using raw fetch ─────────
export function handle401(res: Response): boolean {
  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('token');
    localStorage.removeItem('admin_token');
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user');
    document.cookie = 'token=; path=/; max-age=0';
    document.cookie = 'admin_token=; path=/; max-age=0';
    window.location.href = `/auth/login?expired=true`;
    return true;
  }
  return false;
}

// ─── Global 403 handler ──────────────────────────────────
export async function handle403(res: Response): Promise<string> {
  try {
    const body = await res.clone().json();
    return body.message || 'You do not have permission to perform this action.';
  } catch {
    return 'Access denied. You do not have the required permissions.';
  }
}

// ─── Fetch wrapper with automatic 401/403 handling ───────
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    handle401(res);
    throw new ApiError({ status: 401, message: 'Session expired. Please log in again.' });
  }
  if (res.status === 403) {
    const message = await handle403(res);
    throw new ApiError({ status: 403, message });
  }
  return res;
}

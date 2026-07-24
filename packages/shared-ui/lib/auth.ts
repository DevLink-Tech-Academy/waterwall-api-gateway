'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

// ─── Types ───────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

interface JwtPayload {
  sub: string;
  email: string;
  displayName?: string;
  roles?: string[];
  permissions?: string[];
  exp: number;
  iat: number;
  // Keycloak-issued tokens carry these instead of the native claims above.
  preferred_username?: string;
  name?: string;
  realm_access?: { roles?: string[] };
}

interface LoginResponse {
  token: string;
  refreshToken?: string;
  user: AuthUser;
}

const TOKEN_KEY = 'token';

// ─── Token management ────────────────────────────────────────
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY)
    || localStorage.getItem('admin_token')
    || localStorage.getItem('jwt_token');
}

function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('admin_token');
  localStorage.removeItem('jwt_token');
}

// ─── JWT decoding ────────────────────────────────────────────
function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

// ─── Public functions ────────────────────────────────────────
export function getUser(): AuthUser | null {
  const token = getToken();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload) return null;
  // Support both the native identity-service claims and Keycloak's.
  const roles = payload.roles ?? payload.realm_access?.roles ?? [];
  const email = payload.email ?? payload.preferred_username ?? '';
  return {
    id: payload.sub,
    email,
    displayName: payload.displayName ?? payload.name ?? payload.preferred_username ?? email,
    roles,
    permissions: payload.permissions ?? [],
  };
}

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  const payload = decodeJwt(token);
  if (!payload) return false;
  // Check expiration (exp is in seconds)
  return payload.exp * 1000 > Date.now();
}

// Read config at call-time from runtime env (window.__ENV, injected by the
// container entrypoint into /public/__env.js) with a fall-back to the
// build-time NEXT_PUBLIC_* value. This lets the same image be configured per
// deployment — standalone Next.js bakes NEXT_PUBLIC_* at build otherwise.
function cfg(key: string, fallback = ''): string {
  if (typeof window !== 'undefined') {
    const env = (window as unknown as { __ENV?: Record<string, string> }).__ENV;
    if (env && env[key]) return env[key];
  }
  const fromProcess = (process.env as Record<string, string | undefined>)[key];
  return fromProcess || fallback;
}

const identityUrl = () => cfg('NEXT_PUBLIC_IDENTITY_URL', 'http://localhost:8081');
// When NEXT_PUBLIC_KEYCLOAK_ISSUER is set (e.g. https://<host>/realms/bdp) the
// login form authenticates against Keycloak instead of identity-service. The
// resource-server APIs already trust Keycloak, so the resulting token is
// accepted platform-wide (single BDP identity).
const keycloakIssuer = () => cfg('NEXT_PUBLIC_KEYCLOAK_ISSUER', '');
const keycloakClient = () => cfg('NEXT_PUBLIC_KEYCLOAK_CLIENT_ID', 'gateway-ui');

export function isKeycloakMode(): boolean {
  return !!keycloakIssuer();
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const kcIssuer = keycloakIssuer();
  if (kcIssuer) {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: keycloakClient(),
      username: email,
      password,
      scope: 'openid',
    });
    const res = await fetch(`${kcIssuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      throw new Error(b?.error_description || b?.error || `Login failed (${res.status})`);
    }
    const data = await res.json();
    if (data.access_token) setToken(data.access_token);
    return getUser()!;
  }

  const res = await fetch(`${identityUrl()}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `Login failed (${res.status})`);
  }
  const data = await res.json();
  const jwt = data.accessToken || data.token;
  if (jwt) setToken(jwt);
  return data.user ?? getUser()!;
}

export async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthUser> {
  const res = await fetch(`${identityUrl()}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `Registration failed (${res.status})`);
  }
  const data = await res.json();
  const jwt = data.accessToken || data.token;
  if (jwt) setToken(jwt);
  return data.user ?? getUser()!;
}

export function logout(): void {
  clearToken();
  if (typeof window !== 'undefined') {
    window.location.href = '/auth/login';
  }
}

// ─── React hook ──────────────────────────────────────────────
export interface UseAuthReturn {
  user: AuthUser | null;
  token: string | null;
  permissions: string[];
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

export function useAuth(): UseAuthReturn {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  // Initialize from localStorage on mount
  useEffect(() => {
    const storedToken = getToken();
    if (storedToken && isAuthenticated()) {
      setTokenState(storedToken);
      setUser(getUser());
    }
  }, []);

  const permissions = useMemo(
    () => user?.permissions ?? [],
    [user],
  );

  const authenticated = useMemo(
    () => !!token && !!user,
    [token, user],
  );

  const doLogin = useCallback(async (email: string, password: string) => {
    const loggedInUser = await login(email, password);
    setTokenState(getToken());
    setUser(loggedInUser);
    return loggedInUser;
  }, []);

  const doLogout = useCallback(() => {
    logout();
    setTokenState(null);
    setUser(null);
  }, []);

  return {
    user,
    token,
    permissions,
    isAuthenticated: authenticated,
    login: doLogin,
    logout: doLogout,
  };
}

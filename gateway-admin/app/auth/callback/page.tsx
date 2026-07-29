'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// Runtime config: NEXT_PUBLIC_* are written into window.__ENV by the container
// entrypoint (loaded via /__env.js in the root layout).
function runtimeEnv(key: string, fallback = ''): string {
  if (typeof window !== 'undefined') {
    const env = (window as unknown as { __ENV?: Record<string, string> }).__ENV;
    if (env && env[key]) return env[key];
  }
  const fromProcess = (process.env as Record<string, string | undefined>)[key];
  return fromProcess || fallback;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(jsonPayload);
  } catch { return null; }
}

// Native identity-service tokens carry roles top-level; BDP Keycloak SSO tokens
// carry them under realm_access.roles. 'admin' is the BDP realm role.
function extractRoles(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const top = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
  const realm = payload.realm_access as { roles?: string[] } | undefined;
  const realmRoles = Array.isArray(realm?.roles) ? (realm!.roles as string[]) : [];
  return [...top, ...realmRoles];
}

const ADMIN_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'API_PUBLISHER_ADMIN', 'API_PUBLISHER', 'COMPLIANCE_OFFICER', 'RELEASE_MANAGER', 'POLICY_MANAGER', 'AUDITOR', 'admin'];

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const fail = (msg: string) => {
      setError(msg);
      setTimeout(() => router.replace(`/auth/login?error=sso&msg=${encodeURIComponent(msg)}`), 2500);
    };

    (async () => {
      const oauthErr = searchParams.get('error');
      if (oauthErr) {
        fail(searchParams.get('error_description') || oauthErr);
        return;
      }
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const savedState = sessionStorage.getItem('kc_oauth_state');
      const verifier = sessionStorage.getItem('kc_pkce_verifier');

      if (!code) { fail('No authorization code returned by BDP'); return; }
      if (!state || state !== savedState) { fail('SSO state mismatch — please try again'); return; }
      if (!verifier) { fail('Missing PKCE verifier — please try again'); return; }

      const issuer = runtimeEnv('NEXT_PUBLIC_KEYCLOAK_ISSUER', '');
      const clientId = runtimeEnv('NEXT_PUBLIC_KEYCLOAK_CLIENT_ID', 'gateway-ui');
      const redirectUri = `${window.location.origin}/auth/callback`;

      try {
        const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier,
          }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => null);
          throw new Error(b?.error_description || b?.error || `Token exchange failed (${res.status})`);
        }
        const data = await res.json();
        const token = data.access_token;
        if (!token) throw new Error('No access token received from BDP');

        const roles = extractRoles(decodeJwtPayload(token));
        if (!roles.some((r) => ADMIN_ROLES.includes(r))) {
          throw new Error('Admin access required. Your BDP account does not have admin console access.');
        }

        sessionStorage.removeItem('kc_pkce_verifier');
        sessionStorage.removeItem('kc_oauth_state');
        localStorage.setItem('admin_token', token);
        document.cookie = `admin_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
        router.replace('/');
      } catch (err) {
        fail(err instanceof Error ? err.message : 'BDP SSO sign-in failed');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="text-center">
        {error ? (
          <div className="max-w-md px-4 py-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">
            {error}
            <div className="text-slate-400 text-xs mt-2">Returning to sign in…</div>
          </div>
        ) : (
          <>
            <svg className="w-8 h-8 animate-spin text-purple-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-slate-500 text-sm">Completing BDP sign-in…</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <svg className="w-8 h-8 animate-spin text-purple-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    }>
      <CallbackInner />
    </Suspense>
  );
}

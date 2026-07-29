'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL || 'http://localhost:8081';

// Runtime config: the container entrypoint writes NEXT_PUBLIC_* into window.__ENV
// (loaded via /__env.js in the root layout), so BDP SSO can be toggled per
// deployment without a rebuild.
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

// ── BDP SSO (Keycloak OIDC Authorization Code + PKCE) ────────────────────────
function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomUrlSafe(byteLen = 48): string {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr);
}
// Pure-JS SHA-256. Web Crypto (crypto.subtle) is ONLY available in secure
// contexts (HTTPS / localhost); this console is served over plain HTTP on the
// VM, so crypto.subtle is undefined and calling .digest throws
// "Cannot read properties of undefined (reading 'digest')". This fallback keeps
// PKCE S256 working over HTTP; crypto.subtle is still used when available.
function sha256Bytes(ascii: string): Uint8Array {
  const rr = (v: number, a: number) => (v >>> a) | (v << (32 - a));
  const msg = new TextEncoder().encode(ascii);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const k = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const l = msg.length;
  const total = (((l + 8) >> 6) + 1) << 6;
  const bytes = new Uint8Array(total);
  bytes.set(msg);
  bytes[l] = 0x80;
  const dv = new DataView(bytes.buffer);
  dv.setUint32(total - 8, Math.floor((l * 8) / 0x100000000));
  dv.setUint32(total - 4, (l * 8) >>> 0);
  const w = new Uint32Array(64);
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rr(w[t-15],7) ^ rr(w[t-15],18) ^ (w[t-15] >>> 3);
      const s1 = rr(w[t-2],17) ^ rr(w[t-2],19) ^ (w[t-2] >>> 10);
      w[t] = (w[t-16] + s0 + w[t-7] + s1) >>> 0;
    }
    let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + k[t] + w[t]) >>> 0;
      const S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0;
    h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]);
  return out;
}
async function sha256Base64Url(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(new Uint8Array(digest));
  }
  return base64UrlEncode(sha256Bytes(input));
}

const features = [
  {
    icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>,
    title: 'API Governance',
    desc: 'Lifecycle management, approvals, and compliance',
  },
  {
    icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" /></svg>,
    title: 'Real-time Analytics',
    desc: 'Traffic monitoring, latency, and error rates',
  },
  {
    icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>,
    title: 'Security & Auth',
    desc: 'JWT, OAuth2, API Keys, mTLS, and WAF',
  },
  {
    icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>,
    title: 'AI Gateway',
    desc: 'LLM routing, token budgets, and content safety',
  },
];


function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(
    searchParams.get('expired') === 'true' ? 'Your session has expired. Please sign in again.'
    : searchParams.get('error') === 'unauthorized' ? 'Admin access required'
    : ''
  );
  const [loading, setLoading] = useState(false);
  const [ssoIssuer, setSsoIssuer] = useState('');
  const [ssoLoading, setSsoLoading] = useState(false);

  // Resolve runtime SSO config after mount (window.__ENV is browser-only).
  useEffect(() => {
    setSsoIssuer(runtimeEnv('NEXT_PUBLIC_KEYCLOAK_ISSUER', ''));
    const msg = searchParams.get('msg');
    if (searchParams.get('error') === 'sso' && msg) {
      setError(decodeURIComponent(msg));
    }
  }, [searchParams]);

  const handleSsoLogin = async () => {
    setError('');
    setSsoLoading(true);
    try {
      const issuer = runtimeEnv('NEXT_PUBLIC_KEYCLOAK_ISSUER', '');
      const clientId = runtimeEnv('NEXT_PUBLIC_KEYCLOAK_CLIENT_ID', 'gateway-ui');
      const verifier = randomUrlSafe(48);
      const challenge = await sha256Base64Url(verifier);
      const state = randomUrlSafe(16);
      sessionStorage.setItem('kc_pkce_verifier', verifier);
      sessionStorage.setItem('kc_oauth_state', state);
      const redirectUri = `${window.location.origin}/auth/callback`;
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        scope: 'openid',
        redirect_uri: redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      window.location.href = `${issuer}/protocol/openid-connect/auth?${params.toString()}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start BDP SSO');
      setSsoLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${IDENTITY_URL}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Invalid credentials');
      }
      const data = await res.json();
      const token = data.token || data.accessToken;
      if (!token) throw new Error('No token received');

      const payload = decodeJwtPayload(token);
      const roles: string[] = (payload?.roles as string[]) || [];
      const adminRoles = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'API_PUBLISHER_ADMIN', 'API_PUBLISHER', 'COMPLIANCE_OFFICER', 'RELEASE_MANAGER', 'POLICY_MANAGER', 'AUDITOR'];
      if (!roles.some(r => adminRoles.includes(r))) {
        throw new Error('Admin access required. Your role does not have admin console access.');
      }

      localStorage.setItem('admin_token', token);
      document.cookie = `admin_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <svg className="absolute top-0 left-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" /></pattern></defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>
        <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-blue-500/15 rounded-full blur-3xl" />

        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20 py-16 w-full">
          <div className="flex items-center gap-3 mb-12">
            <img src="/logo.svg" alt="Waterwall" className="w-11 h-11 rounded-xl shadow-lg shadow-purple-900/40" />
            <div>
              <div className="text-white font-bold text-lg leading-tight">Waterwall</div>
              <div className="text-purple-400/70 text-xs font-medium tracking-wide uppercase">Admin Console</div>
            </div>
          </div>

          <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-4">
            Manage your
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-300">API platform</span>
          </h1>
          <p className="text-purple-200/60 text-lg mb-12 max-w-md leading-relaxed">
            Full control over APIs, users, subscriptions, policies, and gateway infrastructure.
          </p>

          <div className="grid grid-cols-2 gap-4">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl bg-white/[0.06] border border-white/[0.08] p-4 backdrop-blur-sm hover:bg-white/[0.1] transition-colors">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 text-purple-300 flex items-center justify-center mb-3">
                  {f.icon}
                </div>
                <div className="text-white text-sm font-semibold mb-1">{f.title}</div>
                <div className="text-purple-300/50 text-xs leading-relaxed">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-md">
          {/* Mobile-only brand */}
          <div className="lg:hidden text-center mb-8">
            <img src="/logo.svg" alt="Waterwall" className="w-12 h-12 rounded-xl shadow-lg mb-3 mx-auto" />
            <h1 className="text-xl font-bold text-slate-900">Waterwall</h1>
            <p className="text-slate-400 text-sm">Admin Console</p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200/60 p-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Welcome back</h2>
            <p className="text-slate-400 text-sm mb-8">Sign in to the admin console</p>

            {error && (
              <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                {error}
              </div>
            )}

            {ssoIssuer && (
              <div className="mb-6">
                <button type="button" onClick={handleSsoLogin} disabled={ssoLoading}
                  className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm">
                  {ssoLoading
                    ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>}
                  {ssoLoading ? 'Redirecting to BDP...' : 'Sign in with BDP SSO'}
                </button>
                <p className="mt-2 text-center text-xs text-slate-400">Use your BDP platform credentials</p>
                <div className="flex items-center gap-3 my-5">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs text-slate-400 uppercase tracking-wide">or</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="email">Email address</label>
                <input id="email" type="email" required autoFocus autoComplete="email"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-slate-800 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                  placeholder="admin@gateway.local" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="password">Password</label>
                <input id="password" type="password" required autoComplete="current-password"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-slate-800 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                  placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm shadow-purple-600/20">
                {loading && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <svg className="w-8 h-8 animate-spin text-purple-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

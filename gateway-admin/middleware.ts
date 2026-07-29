import { NextRequest, NextResponse } from 'next/server';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8');
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow auth routes and static assets
  if (
    pathname.startsWith('/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png')
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get('admin_token')?.value;

  // No token → redirect to login
  if (!token) {
    const loginUrl = new URL('/auth/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Decode and verify admin role
  const payload = decodeJwtPayload(token);
  if (!payload) {
    const loginUrl = new URL('/auth/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Native identity-service tokens carry roles top-level; BDP Keycloak SSO tokens
  // carry them under realm_access.roles. Accept both.
  const topRoles: string[] = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
  const realmAccess = payload.realm_access as { roles?: string[] } | undefined;
  const realmRoles: string[] = Array.isArray(realmAccess?.roles) ? (realmAccess!.roles as string[]) : [];
  const roles: string[] = [...topRoles, ...realmRoles];
  // 'admin' is the BDP Keycloak realm role (maps to SUPER_ADMIN on the backends).
  const adminRoles = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'API_PUBLISHER_ADMIN', 'API_PUBLISHER', 'COMPLIANCE_OFFICER', 'RELEASE_MANAGER', 'POLICY_MANAGER', 'AUDITOR', 'admin'];
  const isAdmin = roles.some(r => adminRoles.includes(r));

  if (!isAdmin) {
    const loginUrl = new URL('/auth/login?error=unauthorized', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|__env.js).*)'],
};

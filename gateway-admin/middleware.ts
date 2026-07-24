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

  const roles: string[] = (payload.roles as string[]) || [];
  const adminRoles = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'API_PUBLISHER_ADMIN', 'API_PUBLISHER', 'COMPLIANCE_OFFICER', 'RELEASE_MANAGER', 'POLICY_MANAGER', 'AUDITOR'];
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

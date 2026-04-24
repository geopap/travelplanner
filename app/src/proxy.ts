import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseMiddlewareClient } from './lib/supabase/middleware';

const PROTECTED_PAGE_PREFIXES = ['/trips', '/account'];
const PROTECTED_API_PREFIXES = ['/api/trips', '/api/account'];

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function redirectToSignIn(req: NextRequest): NextResponse {
  const redirectTarget = req.nextUrl.pathname + req.nextUrl.search;
  const signInUrl = new URL('/sign-in', req.url);
  signInUrl.searchParams.set('redirect', redirectTarget);
  return NextResponse.redirect(signInUrl);
}

function jsonUnauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'unauthorized', message: 'Unauthorized', details: {} } },
    { status: 401 },
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { supabase, response } = createSupabaseMiddlewareClient(request);
  const { data } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((p) =>
    pathname === p || pathname.startsWith(`${p}/`),
  );
  const isProtectedApi = PROTECTED_API_PREFIXES.some((p) =>
    pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!data.user && (isProtectedPage || isProtectedApi)) {
    return isApiPath(pathname) ? jsonUnauthorized() : redirectToSignIn(request);
  }
  return response;
}

export const config = {
  matcher: [
    '/trips/:path*',
    '/account/:path*',
    '/api/trips/:path*',
    '/api/account/:path*',
  ],
};

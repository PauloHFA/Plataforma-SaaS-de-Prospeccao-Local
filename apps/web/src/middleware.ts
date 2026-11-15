import { NextResponse, type NextRequest } from 'next/server';

const PREVIEW_BASE_DOMAIN = (
  process.env.NEXT_PUBLIC_PREVIEW_BASE_DOMAIN ||
  process.env.PREVIEW_BASE_DOMAIN ||
  'preview.localhost'
).toLowerCase();

export function middleware(request: NextRequest) {
  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const hostname = rawHost.toLowerCase().split(':')[0] || '';

  if (!hostname) return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Never rewrite internal Next.js assets, stock assets, API routes, or known SaaS paths
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/stock') ||
    pathname.startsWith('/_sites') ||
    pathname.startsWith('/preview') ||
    pathname.startsWith('/checkout') ||
    pathname.startsWith('/portal') ||
    pathname.startsWith('/opt-out')
  ) {
    return NextResponse.next();
  }

  const isLocalAppHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('app.');

  if (isLocalAppHost) {
    return NextResponse.next();
  }

  // Wildcard preview subdomain (*.preview.localhost / *.preview.dominio.com) OR custom domain
  if (hostname.endsWith(`.${PREVIEW_BASE_DOMAIN}`) || hostname.includes('.')) {
    const url = request.nextUrl.clone();
    url.pathname = `/_sites/${hostname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

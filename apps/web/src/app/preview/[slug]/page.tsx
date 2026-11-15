import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteRenderer } from '@plataforma/templates';
import type { SiteDocument, SiteStatus } from '@plataforma/shared';

export const dynamic = 'force-dynamic';

interface PublicSiteResponse {
  site: {
    id: string;
    subdomainSlug: string;
    customDomain: string | null;
    status: SiteStatus;
    templateSlug: string;
    contentJson: SiteDocument;
    cacheVersion: number;
  };
  checkoutUrl: string | null;
}

async function fetchSiteBySlug(slug: string): Promise<PublicSiteResponse | null> {
  const apiUrl = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(
    /\/$/,
    '',
  );
  try {
    const resp = await fetch(`${apiUrl}/api/public/sites/by-slug/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!resp.ok) return null;
    return (await resp.json()) as PublicSiteResponse;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchSiteBySlug(slug);
  if (!data) {
    return { title: 'Site não encontrado', robots: { index: false, follow: false } };
  }

  const { site } = data;
  const doc = site.contentJson;
  const isPreview = site.status !== 'PUBLISHED';

  return {
    title: doc.seo.title,
    description: doc.seo.description,
    keywords: doc.seo.keywords,
    robots: isPreview ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: doc.seo.title,
      description: doc.seo.description,
      type: 'website',
    },
  };
}

export default async function PreviewSitePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await fetchSiteBySlug(slug);
  if (!data) notFound();

  const publicApiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(
    /\/$/,
    '',
  );

  return (
    <SiteRenderer
      document={data.site.contentJson}
      siteId={data.site.id}
      status={data.site.status}
      checkoutUrl={data.checkoutUrl || undefined}
      apiBaseUrl={publicApiUrl}
      mediaBaseUrl={publicApiUrl}
    />
  );
}

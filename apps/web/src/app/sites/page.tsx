'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  Globe,
  MessageCircle,
  Search,
} from 'lucide-react';
import { ConsoleShell } from '@/components/ConsoleShell';
import { apiFetch, getApiBaseUrl } from '@/lib/api-client';
import type { SiteDocument } from '@plataforma/shared';

interface SiteRow {
  id: string;
  subdomainSlug: string;
  customDomain: string | null;
  status: string;
  templateSlug: string;
  primaryColor: string;
  previewViewsCount: number;
  whatsappClicksCount: number;
  previewUrl: string;
  contentJson: SiteDocument;
}

const STATUS_TABS: Array<{ key: 'ALL' | 'PREVIEW' | 'PUBLISHED' | 'SUSPENDED' | 'ARCHIVED'; label: string }> = [
  { key: 'ALL', label: 'Todos' },
  { key: 'PREVIEW', label: 'Preview' },
  { key: 'PUBLISHED', label: 'Publicados' },
  { key: 'SUSPENDED', label: 'Suspensos' },
  { key: 'ARCHIVED', label: 'Arquivados' },
];

export default function SitesPage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'PREVIEW' | 'PUBLISHED' | 'SUSPENDED' | 'ARCHIVED'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedSiteId, setCopiedSiteId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ sites: SiteRow[] }>('/api/sites')
      .then((res) => setSites(res.sites))
      .catch(() => {});
  }, []);

  const filteredSites = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sites.filter((site) => {
      if (statusFilter !== 'ALL' && site.status !== statusFilter) return false;
      if (!q) return true;
      return (
        site.contentJson.business.name.toLowerCase().includes(q) ||
        site.subdomainSlug.toLowerCase().includes(q) ||
        (site.customDomain && site.customDomain.toLowerCase().includes(q)) ||
        site.templateSlug.toLowerCase().includes(q)
      );
    });
  }, [sites, statusFilter, searchQuery]);

  const handleCopyUrl = async (site: SiteRow) => {
    const targetUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/preview/${site.subdomainSlug}`
        : site.previewUrl;
    try {
      await navigator.clipboard?.writeText(targetUrl);
      setCopiedSiteId(site.id);
      setTimeout(() => setCopiedSiteId((cur) => (cur === site.id ? null : cur)), 2000);
    } catch {
      // Clipboard blocked in headless browser
    }
  };

  return (
    <ConsoleShell
      title="Sites Gerados e Prévias SPA (RF-07 a RF-12)"
      subtitle="Gerencie landing pages geradas por IA, acesse o Editor Rápido pré-envio e acompanhe telemetria."
    >
      <div className="space-y-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_TABS.map((tabItem) => {
              const count =
                tabItem.key === 'ALL'
                  ? sites.length
                  : sites.filter((s) => s.status === tabItem.key).length;
              return (
                <button
                  key={tabItem.key}
                  type="button"
                  data-testid={`sites-filter-${tabItem.key}`}
                  onClick={() => setStatusFilter(tabItem.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    statusFilter === tabItem.key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tabItem.label} ({count})
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="search"
              data-testid="sites-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar empresa, slug ou domínio..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredSites.map((site) => {
            const heroUrl = site.contentJson.hero.heroImageUrl.startsWith('/api/media/')
              ? `${getApiBaseUrl()}${site.contentJson.hero.heroImageUrl}`
              : site.contentJson.hero.heroImageUrl;
            return (
              <div
                key={site.id}
                className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="h-36 bg-slate-100 relative overflow-hidden">
                    <img
                      src={heroUrl}
                      alt={site.contentJson.business.name}
                      className="w-full h-full object-cover"
                    />
                    <span
                      className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        site.status === 'PUBLISHED'
                          ? 'bg-emerald-600 text-white'
                          : site.status === 'SUSPENDED'
                            ? 'bg-amber-600 text-white'
                            : site.status === 'ARCHIVED'
                              ? 'bg-slate-600 text-white'
                              : 'bg-slate-900/90 text-white'
                      }`}
                    >
                      {site.status}
                    </span>
                  </div>
                  <div className="p-5 space-y-2">
                    <h2 className="font-bold text-slate-900 truncate">
                      {site.contentJson.business.name}
                    </h2>
                    <p className="text-xs text-slate-500 truncate">
                      {site.customDomain || `${site.subdomainSlug}.preview`} · Template:{' '}
                      <strong>{site.templateSlug}</strong>
                    </p>
                    <div className="flex items-center gap-4 pt-2 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5 text-indigo-500" /> {site.previewViewsCount} views
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />{' '}
                        {site.whatsappClicksCount} cliques
                      </span>
                    </div>
                  </div>
                </div>

                <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2">
                  <Link
                    href={`/sites/${site.id}/editor`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Editor Rápido
                  </Link>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleCopyUrl(site)}
                      title="Copiar link de prévia"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-100"
                    >
                      {copiedSiteId === site.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" /> Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Link
                        </>
                      )}
                    </button>
                    <a
                      href={`/preview/${site.subdomainSlug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-100"
                    >
                      Abrir <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredSites.length === 0 && (
            <div className="col-span-full bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-3">
              <Globe className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm text-slate-600">
                {sites.length === 0 ? (
                  <>
                    Nenhum site gerado ainda. Vá até <strong>Captação de Leads</strong> e clique em{' '}
                    <strong>Gerar Site IA</strong>.
                  </>
                ) : (
                  'Nenhum site encontrado para este filtro ou termo de busca.'
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </ConsoleShell>
  );
}

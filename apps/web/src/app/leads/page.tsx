'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Compass,
  Download,
  ExternalLink,
  Phone,
  Search,
  Sparkles,
  Star,
  XCircle,
} from 'lucide-react';
import { ConsoleShell } from '@/components/ConsoleShell';
import { apiFetch } from '@/lib/api-client';
import { WEBSITE_CATEGORY_LABELS, type WebsiteCategory } from '@plataforma/shared';

interface LeadItem {
  id: string;
  placeId: string;
  businessName: string;
  category: string;
  niche: string;
  phoneRaw: string | null;
  phoneE164: string | null;
  phoneType: 'MOBILE' | 'LANDLINE' | 'UNKNOWN';
  whatsappValid: boolean | null;
  websiteUrl: string | null;
  websiteCategory: WebsiteCategory;
  websitePlatformLabel: string | null;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  rating: number;
  reviewCount: number;
  funnelStage: string;
  site: {
    id: string;
    subdomainSlug: string;
    status: string;
  } | null;
}

export default function LeadsPage() {
  const router = useRouter();
  const [keyword, setKeyword] = useState('Clínica Odontológica');
  const [city, setCity] = useState('São Paulo');
  const [state, setState] = useState('SP');
  const [neighborhood, setNeighborhood] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [radiusKm, setRadiusKm] = useState(5);
  const [websiteFilter, setWebsiteFilter] = useState<
    'WITHOUT_OWN_SITE' | 'NO_WEBSITE' | 'SOCIAL_ONLY' | 'ALL'
  >('WITHOUT_OWN_SITE');

  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [generatingLeadId, setGeneratingLeadId] = useState<string | null>(null);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchNotice, setBatchNotice] = useState('');
  const [searchStats, setSearchStats] = useState<{
    totalFound: number;
    newInserted: number;
    deduplicated: number;
    creditsConsumed: number;
    cacheHit: boolean;
  } | null>(null);
  const [error, setError] = useState('');

  const loadExisting = async () => {
    try {
      const res = await apiFetch<{ leads: LeadItem[] }>('/api/leads');
      setLeads(res.leads);
      setSelectedLeadIds((prev) =>
        prev.filter((id) => res.leads.some((lead) => lead.id === id && !lead.site)),
      );
    } catch {
      // handled by shell
    }
  };

  useEffect(() => {
    void loadExisting();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    setError('');
    try {
      const res = await apiFetch<{
        leads: LeadItem[];
        stats: {
          totalFound: number;
          newInserted: number;
          deduplicated: number;
          creditsConsumed: number;
          cacheHit: boolean;
        };
      }>('/api/leads/search', {
        method: 'POST',
        json: {
          keyword,
          city,
          state,
          neighborhood: neighborhood || undefined,
          postalCode: postalCode || undefined,
          radiusKm,
          websiteFilter,
          limit: 20,
          waitForValidation: true,
        },
      });
      setSearchStats(res.stats);
      await loadExisting();
    } catch (err: any) {
      setError(err.message || 'Erro ao pesquisar estabelecimentos.');
    } finally {
      setSearching(false);
    }
  };

  const handleGenerateSite = async (leadId: string) => {
    setGeneratingLeadId(leadId);
    setError('');
    setBatchNotice('');
    try {
      const res = await apiFetch<{ site: { id: string } }>('/api/sites/generate', {
        method: 'POST',
        json: { leadId },
      });
      router.push(`/sites/${res.site.id}/editor`);
    } catch (err: any) {
      setError(err.message || 'Falha ao gerar site IA.');
    } finally {
      setGeneratingLeadId(null);
    }
  };

  const eligibleBatchIds = leads.filter((l) => !l.site).map((l) => l.id);
  const allEligibleSelected =
    eligibleBatchIds.length > 0 &&
    eligibleBatchIds.every((id) => selectedLeadIds.includes(id));

  const toggleSelectLead = (leadId: string) => {
    setSelectedLeadIds((prev) =>
      prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId],
    );
  };

  const toggleSelectAllEligible = () => {
    if (allEligibleSelected) {
      setSelectedLeadIds([]);
    } else {
      setSelectedLeadIds(eligibleBatchIds);
    }
  };

  const handleBatchGenerate = async () => {
    const targetIds = selectedLeadIds.filter((id) => eligibleBatchIds.includes(id));
    if (targetIds.length === 0) return;
    setBatchGenerating(true);
    setError('');
    setBatchNotice('');
    try {
      const res = await apiFetch<{
        queuedCount: number;
        skippedCount: number;
        sites?: Array<{ id: string }>;
      }>('/api/sites/generate-batch', {
        method: 'POST',
        json: { leadIds: targetIds, waitForCompletion: true },
      });
      const generatedCount = res.sites?.length ?? res.queuedCount;
      setBatchNotice(
        `${generatedCount} site(s) SPA gerados em lote com sucesso! (${res.skippedCount} ignorado(s)).`,
      );
      setSelectedLeadIds([]);
      await loadExisting();
    } catch (err: any) {
      setError(err.message || 'Falha na geração em lote.');
    } finally {
      setBatchGenerating(false);
    }
  };

  const handleExportCsv = () => {
    const escapeCsv = (val: string | number | boolean | null | undefined) => {
      const s = String(val ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };
    const headers = [
      'Empresa',
      'Categoria',
      'Bairro',
      'Cidade',
      'UF',
      'Presenca Web',
      'Telefone',
      'WhatsApp Ativo',
      'Avaliacao',
      'Estagio',
      'Subdominio',
    ];
    const rows = leads.map((l) =>
      [
        l.businessName,
        l.category,
        l.neighborhood,
        l.city,
        l.state,
        WEBSITE_CATEGORY_LABELS[l.websiteCategory] ?? l.websiteCategory,
        l.phoneE164 || l.phoneRaw || '',
        l.whatsappValid === true ? 'Sim' : 'Nao',
        `${l.rating.toFixed(1)} (${l.reviewCount})`,
        l.funnelStage,
        l.site ? `/preview/${l.site.subdomainSlug}` : '',
      ]
        .map(escapeCsv)
        .join(';'),
    );
    const csvContent = '\ufeff' + [headers.join(';'), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'leads-workspace.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <ConsoleShell
      title="Captação Georreferenciada e Higienização (RF-01 a RF-05)"
      subtitle="Descubra empresas sem website próprio, valide WhatsApp e gere prévias SPA instantaneamente."
    >
      <div className="space-y-6">
        {/* Formulário de Busca Geográfica */}
        <form
          onSubmit={handleSearch}
          className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nicho ou Palavra-chave (RF-01)
              </label>
              <input
                required
                data-testid="search-keyword-input"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Ex: Clínica Odontológica, Oficina Mecânica"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Cidade</label>
              <input
                required
                data-testid="search-city-input"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Bairro / CEP</label>
              <input
                value={neighborhood || postalCode}
                onChange={(e) => setNeighborhood(e.target.value)}
                placeholder="Opcional (ex: Pinheiros)"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Raio (km)</label>
              <input
                type="number"
                min={1}
                max={50}
                value={radiusKm}
                onChange={(e) => setRadiusKm(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Presença Web (RF-02)
              </label>
              <select
                data-testid="search-website-filter"
                value={websiteFilter}
                onChange={(e) => setWebsiteFilter(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="WITHOUT_OWN_SITE">Sem site próprio</option>
                <option value="NO_WEBSITE">Somente sem nenhum link</option>
                <option value="SOCIAL_ONLY">Apenas Redes Sociais</option>
                <option value="ALL">Todos (incluir domínios)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Compass className="w-4 h-4 text-indigo-500" />
              <span>
                Deduplicação por Place ID/E.164/Endereço ativa · Cache geográfico compartilhado (RN-01)
              </span>
            </div>
            <button
              type="submit"
              disabled={searching}
              data-testid="search-leads-submit"
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              {searching ? 'Captando e validando WhatsApp...' : 'Buscar e Higienizar Leads'}
            </button>
          </div>
        </form>

        {error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
            {error}
          </div>
        )}

        {searchStats && (
          <div
            data-testid="search-stats-banner"
            className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs sm:text-sm flex flex-wrap items-center justify-between gap-3"
          >
            <span>
              Busca concluída: <strong>{searchStats.totalFound}</strong> locais compatíveis ·{' '}
              <strong>{searchStats.newInserted}</strong> novos salvos ·{' '}
              <strong>{searchStats.deduplicated}</strong> deduplicados (sem consumo extra) ·{' '}
              <strong>{searchStats.creditsConsumed}</strong> créditos debitados
            </span>
            {searchStats.cacheHit && (
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-200/70 font-semibold text-xs">
                Cache Geográfico Hit (RN-01)
              </span>
            )}
          </div>
        )}

        {/* Tabela de Leads Extraídos */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-slate-900">
              Leads do Workspace ({leads.length})
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {selectedLeadIds.length > 0 && (
                <button
                  type="button"
                  data-testid="batch-generate-btn"
                  onClick={handleBatchGenerate}
                  disabled={batchGenerating}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-semibold"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {batchGenerating
                    ? 'Gerando Lote...'
                    : `Gerar Sites em Lote (${selectedLeadIds.length})`}
                </button>
              )}
              <button
                type="button"
                data-testid="export-leads-csv-btn"
                onClick={handleExportCsv}
                disabled={leads.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar CSV
              </button>
            </div>
          </div>

          {batchNotice && (
            <div
              data-testid="batch-generate-notice"
              className="mx-6 mt-4 p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs font-medium flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>{batchNotice}</span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os leads elegíveis"
                      data-testid="select-all-leads-checkbox"
                      checked={allEligibleSelected}
                      disabled={eligibleBatchIds.length === 0}
                      onChange={toggleSelectAllEligible}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th className="py-3 px-4">Empresa</th>
                  <th className="py-3 px-4">Presença Web (RN-02)</th>
                  <th className="py-3 px-4">Contato & WhatsApp (RF-04)</th>
                  <th className="py-3 px-4">Avaliação</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-4">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${lead.businessName}`}
                        data-testid={`select-lead-${lead.id}`}
                        disabled={Boolean(lead.site)}
                        checked={!lead.site && selectedLeadIds.includes(lead.id)}
                        onChange={() => toggleSelectLead(lead.id)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30"
                      />
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="font-bold text-slate-900">{lead.businessName}</p>
                      <p className="text-xs text-slate-500">
                        {lead.category} · {lead.neighborhood}, {lead.city}
                      </p>
                    </td>

                    <td className="py-3.5 px-4">
                      {lead.websiteCategory === 'NO_WEBSITE' && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Sem Website
                        </span>
                      )}
                      {lead.websiteCategory === 'SOCIAL_ONLY' && (
                        <div className="space-y-1">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            Apenas {lead.websitePlatformLabel || 'Rede Social'}
                          </span>
                          {lead.websiteUrl && (
                            <a
                              href={lead.websiteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-[11px] text-slate-500 truncate max-w-[180px] hover:underline"
                            >
                              {lead.websiteUrl}
                            </a>
                          )}
                        </div>
                      )}
                      {lead.websiteCategory === 'OWN_DOMAIN' && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                          {WEBSITE_CATEGORY_LABELS.OWN_DOMAIN}
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <p className="font-mono text-xs text-slate-800">
                        {lead.phoneE164 || lead.phoneRaw || 'Sem telefone'}
                      </p>
                      <div className="mt-1">
                        {lead.whatsappValid === true ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" /> WhatsApp Ativo
                          </span>
                        ) : lead.phoneType === 'LANDLINE' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                            <Phone className="w-3.5 h-3.5" /> Fixo (Ligar / E-mail)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600">
                            <XCircle className="w-3.5 h-3.5" /> Sem WhatsApp
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-800">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        {lead.rating.toFixed(1)} ({lead.reviewCount})
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                      {lead.site ? (
                        <>
                          <button
                            type="button"
                            onClick={() => router.push(`/sites/${lead.site!.id}/editor`)}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                          >
                            Editar Site
                          </button>
                          <a
                            href={`/preview/${lead.site.subdomainSlug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Prévia <ExternalLink className="w-3 h-3" />
                          </a>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleGenerateSite(lead.id)}
                          disabled={generatingLeadId === lead.id}
                          data-testid={`generate-site-btn-${lead.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-semibold"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {generatingLeadId === lead.id ? 'Gerando...' : 'Gerar Site IA'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}

                {leads.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-sm text-slate-500">
                      Nenhum lead captado neste workspace ainda. Execute uma busca geográfica acima!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ConsoleShell>
  );
}

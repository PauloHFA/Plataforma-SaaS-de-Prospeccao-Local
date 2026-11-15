'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  ExternalLink,
  Globe,
  Monitor,
  Palette,
  RotateCcw,
  Save,
  Send,
  Smartphone,
  Upload,
} from 'lucide-react';
import { ConsoleShell } from '@/components/ConsoleShell';
import { apiFetch, getApiBaseUrl, getStoredToken } from '@/lib/api-client';
import { SiteRenderer } from '@plataforma/templates';
import {
  FONT_PAIRINGS,
  type FontPairing,
  type SiteDocument,
  type SiteStatus,
  type TemplateSlug,
} from '@plataforma/shared';

interface TemplateCatalogItem {
  id: string;
  slug: TemplateSlug;
  name: string;
  niche: string;
}

interface SiteDetailResponse {
  site: {
    id: string;
    leadId: string;
    subdomainSlug: string;
    customDomain: string | null;
    status: SiteStatus;
    templateSlug: TemplateSlug;
    primaryColor: string;
    fontPairing: FontPairing;
    contentJson: SiteDocument;
    previewViewsCount: number;
    whatsappClicksCount: number;
    ctaClicksCount: number;
    previewUrl: string;
    clientPortalUrl: string | null;
  };
  lead: {
    id: string;
    businessName: string;
    whatsappValid: boolean | null;
  } | null;
  domainConfig: {
    domain: string;
    expectedCname: string;
    expectedARecord: string;
    dnsStatus: string;
    sslStatus: string;
    verificationError: string | null;
  } | null;
  clientRequests?: Array<{
    id: string;
    requestType: string;
    message: string;
    status: 'OPEN' | 'DONE' | string;
    createdAt: string;
  }>;
}

interface TelemetrySummary {
  previewViewsCount: number;
  whatsappClicksCount: number;
  ctaClicksCount: number;
  byDevice: Record<string, number>;
  recentEvents: Array<{
    id: string;
    eventType: string;
    deviceType: string;
    createdAt: string;
  }>;
}

const COLOR_PRESETS = ['#0F766E', '#2563EB', '#E11D48', '#D97706', '#7C3AED', '#0F172A'];

export default function SiteQuickEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SiteDetailResponse | null>(null);
  const [templates, setTemplates] = useState<TemplateCatalogItem[]>([]);
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetrySummary | null>(null);
  const [tab, setTab] = useState<'editor' | 'telemetry' | 'publish'>('editor');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Checkout & Domain state
  const [billingModel, setBillingModel] = useState<'ONE_TIME' | 'SUBSCRIPTION' | 'HYBRID'>('HYBRID');
  const [setupReais, setSetupReais] = useState('497');
  const [monthlyReais, setMonthlyReais] = useState('97');
  const [checkoutLink, setCheckoutLink] = useState('');
  const [domainInput, setDomainInput] = useState('');
  const [quickMsg, setQuickMsg] = useState(
    'Olá, equipe da {{nome_empresa}}! Criamos a prévia do seu site profissional: {{link_preview}} (Descadastro: {{link_optout}})',
  );
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null);

  const openRequestsCount = (data?.clientRequests ?? []).filter((r) => r.status === 'OPEN').length;

  const handleToggleRequestStatus = async (requestId: string, nextStatus: 'OPEN' | 'DONE') => {
    setUpdatingRequestId(requestId);
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/sites/${id}/requests/${requestId}`, {
        method: 'PATCH',
        json: { status: nextStatus },
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              clientRequests: (prev.clientRequests ?? []).map((req) =>
                req.id === requestId ? { ...req, status: nextStatus } : req,
              ),
            }
          : prev,
      );
      setNotice(
        nextStatus === 'DONE'
          ? 'Solicitação do cliente marcada como concluída.'
          : 'Solicitação do cliente reaberta.',
      );
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar solicitação do cliente.');
    } finally {
      setUpdatingRequestId(null);
    }
  };

  const loadAll = async () => {
    try {
      const [detail, tpls, tel] = await Promise.all([
        apiFetch<SiteDetailResponse>(`/api/sites/${id}`),
        apiFetch<{ templates: TemplateCatalogItem[] }>('/api/templates'),
        apiFetch<TelemetrySummary>(`/api/sites/${id}/telemetry`),
      ]);
      setData(detail);
      setDoc(detail.site.contentJson);
      setTemplates(tpls.templates);
      setTelemetry(tel);
      if (detail.domainConfig?.domain) setDomainInput(detail.domainConfig.domain);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar editor.');
    }
  };

  useEffect(() => {
    if (id) void loadAll();
  }, [id]);

  const handleSave = async () => {
    if (!doc) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/sites/${id}`, {
        method: 'PATCH',
        json: {
          templateSlug: doc.templateSlug,
          primaryColor: doc.theme.primaryColor,
          fontPairing: doc.theme.fontPairing,
          contentPatch: doc,
        },
      });
      setNotice('Alterações salvas e cache público invalidado imediatamente!');
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Falha ao salvar alterações.');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !doc) return;
    const formData = new FormData();
    formData.append('file', file);
    const token = getStoredToken();
    const resp = await fetch(`${getApiBaseUrl()}/api/sites/${id}/media`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
      body: formData,
    });
    if (resp.ok) {
      const uploaded = (await resp.json()) as { url: string };
      setDoc({
        ...doc,
        hero: { ...doc.hero, heroImageUrl: uploaded.url },
      });
      setNotice('Imagem otimizada em WebP aplicada na prévia. Clique em Salvar Alterações.');
    }
  };

  const handleCreateCheckout = async () => {
    setError('');
    const res = await apiFetch<{ checkoutUrl: string }>('/api/checkout/offers', {
      method: 'POST',
      json: {
        siteId: id,
        gateway: 'SANDBOX',
        billingModel,
        setupAmountCents: Math.round(Number(setupReais || 0) * 100),
        monthlyAmountCents: Math.round(Number(monthlyReais || 0) * 100),
      },
    });
    setCheckoutLink(res.checkoutUrl);
    setNotice('Link de checkout gerado com sucesso!');
  };

  const handleSaveDomain = async () => {
    setError('');
    await apiFetch(`/api/sites/${id}/domain`, {
      method: 'POST',
      json: { domain: domainInput },
    });
    setNotice('Domínio registrado. Aponte os registros DNS e clique em Verificar.');
    await loadAll();
  };

  const handleVerifyDomain = async (simulateVerified = false) => {
    setError('');
    const res = await apiFetch<{ verification: { dnsVerified: boolean; error: string | null } }>(
      `/api/sites/${id}/domain/verify`,
      { method: 'POST', json: { simulateVerified } },
    );
    if (res.verification.dnsVerified) {
      setNotice('DNS validado e SSL ativo!');
    } else {
      setError(res.verification.error || 'DNS ainda não propagado.');
    }
    await loadAll();
  };

  const handleQuickSend = async () => {
    if (!data?.lead) return;
    setError('');
    try {
      await apiFetch('/api/campaigns/send-single', {
        method: 'POST',
        json: {
          leadId: data.lead.id,
          channel: 'WHATSAPP',
          bodyTemplate: quickMsg,
          respectBusinessHours: false,
        },
      });
      setNotice('Mensagem enviada com sucesso pelo WhatsApp conectado!');
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!data || !doc) {
    return (
      <ConsoleShell title="Editor Rápido Pré-Envio">
        <p className="text-sm text-slate-500">Carregando editor...</p>
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      title={`Editor Rápido: ${doc.business.name}`}
      subtitle={`Status: ${data.site.status} · Subdomínio: ${data.site.subdomainSlug}`}
    >
      <div className="space-y-4">
        {/* Barra superior de ações */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:px-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('editor')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                tab === 'editor' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Palette className="w-3.5 h-3.5" /> Visual & Textos
            </button>
            <button
              type="button"
              onClick={() => setTab('telemetry')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                tab === 'telemetry' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" /> Telemetria ({telemetry?.previewViewsCount ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setTab('publish')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                tab === 'publish' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" /> Disparo, Checkout & Domínio
              {openRequestsCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                  {openRequestsCount}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:inline-flex border border-slate-200 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setViewport('desktop')}
                className={`p-1.5 rounded ${viewport === 'desktop' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
                title="Visualizar Desktop"
              >
                <Monitor className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewport('mobile')}
                className={`p-1.5 rounded ${viewport === 'mobile' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
                title="Visualizar Mobile 375px"
              >
                <Smartphone className="w-4 h-4" />
              </button>
            </div>

            <a
              href={`/preview/${data.site.subdomainSlug}?preview_admin=1`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="open-public-preview-link"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              URL Pública <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              data-testid="save-site-editor-btn"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </div>

        {notice && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Painel Esquerdo */}
          <div className="xl:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
            {tab === 'editor' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Template SPA
                    </label>
                    <select
                      data-testid="editor-template-select"
                      value={doc.templateSlug}
                      onChange={(e) =>
                        setDoc({ ...doc, templateSlug: e.target.value as TemplateSlug })
                      }
                      className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs bg-white"
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.slug}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Tipografia
                    </label>
                    <select
                      value={doc.theme.fontPairing}
                      onChange={(e) =>
                        setDoc({
                          ...doc,
                          theme: { ...doc.theme, fontPairing: e.target.value as FontPairing },
                        })
                      }
                      className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs bg-white"
                    >
                      {FONT_PAIRINGS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Cor Primária (RF-11)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      data-testid="editor-primary-color-input"
                      value={doc.theme.primaryColor}
                      onChange={(e) =>
                        setDoc({
                          ...doc,
                          theme: { ...doc.theme, primaryColor: e.target.value.toUpperCase() },
                        })
                      }
                      className="w-10 h-9 rounded-lg border border-slate-300 cursor-pointer"
                    />
                    <input
                      type="text"
                      data-testid="editor-primary-color-hex"
                      value={doc.theme.primaryColor}
                      onChange={(e) =>
                        setDoc({
                          ...doc,
                          theme: { ...doc.theme, primaryColor: e.target.value },
                        })
                      }
                      className="w-28 rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
                    />
                    <div className="flex gap-1.5">
                      {COLOR_PRESETS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() =>
                            setDoc({ ...doc, theme: { ...doc.theme, primaryColor: hex } })
                          }
                          className="w-6 h-6 rounded-full border border-black/15"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Título Principal (Headline · máx 90)
                  </label>
                  <input
                    maxLength={90}
                    data-testid="editor-headline-input"
                    value={doc.hero.headline}
                    onChange={(e) =>
                      setDoc({ ...doc, hero: { ...doc.hero, headline: e.target.value } })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Subtítulo (máx 220)
                  </label>
                  <textarea
                    rows={3}
                    maxLength={220}
                    value={doc.hero.subheadline}
                    onChange={(e) =>
                      setDoc({ ...doc, hero: { ...doc.hero, subheadline: e.target.value } })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Texto do Botão Principal (CTA)
                  </label>
                  <input
                    maxLength={35}
                    value={doc.hero.ctaPrimary}
                    onChange={(e) =>
                      setDoc({ ...doc, hero: { ...doc.hero, ctaPrimary: e.target.value } })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Descrição Institucional (Sobre · máx 650)
                  </label>
                  <textarea
                    rows={4}
                    maxLength={650}
                    value={doc.about.description}
                    onChange={(e) =>
                      setDoc({ ...doc, about: { ...doc.about, description: e.target.value } })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Substituir Imagem Principal (WebP)
                  </label>
                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold cursor-pointer hover:bg-slate-50">
                    <Upload className="w-3.5 h-3.5" /> Enviar Nova Foto
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                  </label>
                </div>
              </>
            )}

            {tab === 'telemetry' && telemetry && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="text-xl font-bold text-slate-900">
                      {telemetry.previewViewsCount}
                    </p>
                    <p className="text-[11px] text-slate-500">Visualizações</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="text-xl font-bold text-emerald-700">
                      {telemetry.whatsappClicksCount}
                    </p>
                    <p className="text-[11px] text-slate-500">Cliques WhatsApp</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="text-xl font-bold text-indigo-700">
                      {telemetry.ctaClicksCount}
                    </p>
                    <p className="text-[11px] text-slate-500">Cliques CTA</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-700">Acessos Recentes</p>
                  {telemetry.recentEvents.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhum evento registrado ainda.</p>
                  ) : (
                    telemetry.recentEvents.slice(0, 10).map((ev) => (
                      <div
                        key={ev.id}
                        className="flex justify-between text-xs p-2 rounded-lg bg-slate-50 border border-slate-100"
                      >
                        <span className="font-semibold">{ev.eventType}</span>
                        <span className="text-slate-500">{ev.deviceType}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {tab === 'publish' && (
              <div className="space-y-6">
                {/* Disparo Rápido */}
                <div className="space-y-2 border-b border-slate-200 pb-5">
                  <h3 className="text-xs font-bold uppercase text-slate-600">
                    1. Enviar Prévia via WhatsApp (RF-15)
                  </h3>
                  <textarea
                    rows={3}
                    value={quickMsg}
                    onChange={(e) => setQuickMsg(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-2.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleQuickSend}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500"
                  >
                    <Send className="w-3.5 h-3.5" /> Disparar Mensagem ao Lead
                  </button>
                </div>

                {/* Checkout */}
                <div className="space-y-3 border-b border-slate-200 pb-5">
                  <h3 className="text-xs font-bold uppercase text-slate-600">
                    2. Gerar Link de Checkout (RF-17)
                  </h3>
                  <select
                    value={billingModel}
                    onChange={(e) => setBillingModel(e.target.value as any)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white"
                  >
                    <option value="HYBRID">Híbrido (Setup + Recorrência Mensal)</option>
                    <option value="ONE_TIME">Taxa Única de Implantação</option>
                    <option value="SUBSCRIPTION">Assinatura Mensal</option>
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-slate-600">Setup (R$)</label>
                      <input
                        type="number"
                        value={setupReais}
                        onChange={(e) => setSetupReais(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-600">Mensalidade (R$)</label>
                      <input
                        type="number"
                        value={monthlyReais}
                        onChange={(e) => setMonthlyReais(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateCheckout}
                    className="w-full py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500"
                  >
                    Gerar Link de Checkout
                  </button>
                  {checkoutLink && (
                    <a
                      href={checkoutLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-xs font-semibold text-indigo-700 truncate"
                    >
                      Abrir Checkout: {checkoutLink}
                    </a>
                  )}
                </div>

                {/* Domínio Próprio */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase text-slate-600 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5" /> 3. Domínio Próprio & SSL (RF-19)
                  </h3>
                  <div className="flex gap-2">
                    <input
                      placeholder="Ex: www.clinicaexemplo.com.br"
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value)}
                      className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleSaveDomain}
                      className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold"
                    >
                      Vincular
                    </button>
                  </div>
                  {data.domainConfig && (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                      <p>
                        Aponte <strong>CNAME</strong> para{' '}
                        <code>{data.domainConfig.expectedCname}</code> ou <strong>A</strong> para{' '}
                        <code>{data.domainConfig.expectedARecord}</code>
                      </p>
                      <p>
                        DNS: <strong>{data.domainConfig.dnsStatus}</strong> · SSL:{' '}
                        <strong>{data.domainConfig.sslStatus}</strong>
                      </p>
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleVerifyDomain(false)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold"
                        >
                          Verificar DNS & SSL
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Solicitações do Portal do Cliente */}
                <div
                  data-testid="client-requests-section"
                  className="space-y-3 pt-4 border-t border-slate-100"
                >
                  <h3 className="text-xs font-bold uppercase text-slate-600 flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5" /> 4. Solicitações do Portal (RF-20)
                  </h3>
                  {(data.clientRequests ?? []).length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Nenhuma solicitação de ajuste enviada pelo cliente via portal ainda.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(data.clientRequests ?? []).map((req) => (
                        <div
                          key={req.id}
                          data-testid={`client-request-item-${req.id}`}
                          className={`p-3 rounded-xl border text-xs space-y-2 ${
                            req.status === 'DONE'
                              ? 'bg-slate-50 border-slate-200 text-slate-500'
                              : 'bg-amber-50/70 border-amber-200 text-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[11px] uppercase tracking-wide">
                              {req.requestType}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                req.status === 'DONE'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-200 text-amber-900'
                              }`}
                            >
                              {req.status === 'DONE' ? 'CONCLUÍDO' : 'EM ABERTO'}
                            </span>
                          </div>
                          <p className="leading-relaxed">{req.message}</p>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[11px] text-slate-400">
                              {new Date(req.createdAt).toLocaleString('pt-BR')}
                            </span>
                            {req.status === 'OPEN' ? (
                              <button
                                type="button"
                                data-testid={`resolve-request-btn-${req.id}`}
                                disabled={updatingRequestId === req.id}
                                onClick={() => void handleToggleRequestStatus(req.id, 'DONE')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold disabled:opacity-60"
                              >
                                <CheckCircle2 className="w-3 h-3" /> Marcar Concluído
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-testid={`reopen-request-btn-${req.id}`}
                                disabled={updatingRequestId === req.id}
                                onClick={() => void handleToggleRequestStatus(req.id, 'OPEN')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-semibold disabled:opacity-60"
                              >
                                <RotateCcw className="w-3 h-3" /> Reabrir
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Preview Ao Vivo (Direita) */}
          <div className="xl:col-span-7 bg-slate-200/70 border border-slate-300 rounded-2xl p-3 sm:p-4 overflow-hidden">
            <div
              className={`mx-auto bg-white rounded-xl shadow-lg overflow-hidden border border-slate-300 transition-all ${
                viewport === 'mobile' ? 'max-w-[375px]' : 'w-full'
              }`}
            >
              <SiteRenderer
                document={doc}
                siteId={data.site.id}
                status={data.site.status}
                isEditorPreview={true}
                mediaBaseUrl={getApiBaseUrl()}
              />
            </div>
          </div>
        </div>
      </div>
    </ConsoleShell>
  );
}

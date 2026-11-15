'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Compass,
  Eye,
  Globe,
  MessageSquare,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { ConsoleShell, type WorkspaceUsage } from '@/components/ConsoleShell';
import { apiFetch } from '@/lib/api-client';
import { FUNNEL_STAGE_LABELS, FUNNEL_STAGES, type FunnelStage } from '@plataforma/shared';

interface LeadSummary {
  id: string;
  businessName: string;
  funnelStage: FunnelStage;
  whatsappValid: boolean | null;
}

interface SiteSummary {
  id: string;
  subdomainSlug: string;
  status: string;
  previewViewsCount: number;
  whatsappClicksCount: number;
}

export default function DashboardPage() {
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [sites, setSites] = useState<SiteSummary[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<WorkspaceUsage>('/api/settings/usage'),
      apiFetch<{ leads: LeadSummary[] }>('/api/leads'),
      apiFetch<{ sites: SiteSummary[] }>('/api/sites'),
    ])
      .then(([u, l, s]) => {
        setUsage(u);
        setLeads(l.leads);
        setSites(s.sites);
      })
      .catch(() => {});
  }, []);

  const stageCounts = FUNNEL_STAGES.reduce<Record<string, number>>((acc, st) => {
    acc[st] = leads.filter((l) => l.funnelStage === st).length;
    return acc;
  }, {});

  const totalViews = sites.reduce((acc, s) => acc + s.previewViewsCount, 0);
  const totalClicks = sites.reduce((acc, s) => acc + s.whatsappClicksCount, 0);
  const publishedCount = sites.filter((s) => s.status === 'PUBLISHED').length;

  return (
    <ConsoleShell
      title="Visão Geral Operacional"
      subtitle="Acompanhe seu funil de prospecção, desempenho das prévias SPA e consumo de recursos."
    >
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>LEADS NO FUNIL</span>
              <Compass className="w-4 h-4 text-indigo-600" />
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-2 tabular-nums">
              {leads.length}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {leads.filter((l) => l.whatsappValid).length} com WhatsApp verificado
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>SITES GERADOS</span>
              <Globe className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-2 tabular-nums">
              {sites.length}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {publishedCount} publicados em produção
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>ABERTURAS DE PREVIEW</span>
              <Eye className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-2 tabular-nums">
              {totalViews}
            </p>
            <p className="text-xs text-slate-500 mt-1">{totalClicks} cliques no WhatsApp</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>VENDAS FECHADAS</span>
              <TrendingUp className="w-4 h-4 text-indigo-600" />
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-2 tabular-nums">
              {stageCounts.VENDIDO || 0}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {stageCounts.EM_NEGOCIACAO || 0} em negociação
            </p>
          </div>
        </div>

        {/* Funil de Prospecção */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-900">Distribuição do Funil (RF-06)</h2>
            <Link
              href="/pipeline"
              className="text-xs font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1"
            >
              Abrir Kanban completo <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {FUNNEL_STAGES.map((stage) => (
              <div
                key={stage}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-center"
              >
                <p className="text-xl font-extrabold text-slate-900 tabular-nums">
                  {stageCounts[stage] ?? 0}
                </p>
                <p className="text-[11px] font-medium text-slate-600 mt-1 leading-tight">
                  {FUNNEL_STAGE_LABELS[stage]}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Telemetria e Atalhos */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-600" />
              Consumo & Limites do Plano (RNF-07)
            </h2>
            {usage ? (
              <div className="space-y-3 text-xs">
                <UsageBar
                  label="Buscas Geográficas (mês)"
                  used={usage.monthly.searches}
                  max={usage.plan.maxSearchesPerMonth}
                />
                <UsageBar
                  label="Gerações de Sites IA (mês)"
                  used={usage.monthly.siteGenerations}
                  max={usage.plan.maxSitesPerMonth}
                />
                <UsageBar
                  label="Previews Simultâneos Ativos"
                  used={usage.activePreviews}
                  max={usage.plan.maxActivePreviews}
                />
                <UsageBar
                  label="Disparos Hoje"
                  used={usage.dailyDispatches}
                  max={usage.plan.maxMessagesPerDay}
                />
                <div className="pt-2 flex items-center justify-between text-slate-600 border-t border-slate-100">
                  <span>Tokens LLM consumidos no mês</span>
                  <strong className="tabular-nums">
                    {usage.monthly.totalTokens.toLocaleString('pt-BR')} tokens
                  </strong>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Carregando consumo...</p>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h2 className="font-bold text-slate-900">Ações Rápidas do Fluxo Ponta a Ponta</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Link
                href="/leads"
                className="p-4 rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 transition"
              >
                <Compass className="w-5 h-5 text-indigo-600 mb-2" />
                <p className="font-bold text-sm text-slate-900">Buscar Novos Leads</p>
                <p className="text-xs text-slate-500 mt-1">
                  Filtrar por cidade, raio e ausência de website.
                </p>
              </Link>
              <Link
                href="/campaigns"
                className="p-4 rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 transition"
              >
                <MessageSquare className="w-5 h-5 text-emerald-600 mb-2" />
                <p className="font-bold text-sm text-slate-900">Disparar Campanha</p>
                <p className="text-xs text-slate-500 mt-1">
                  Enviar prévias com spintax e cadência anti-bloqueio.
                </p>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </ConsoleShell>
  );
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="font-bold text-slate-900 tabular-nums">
          {used} / {max}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 90 ? 'bg-rose-500' : 'bg-indigo-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

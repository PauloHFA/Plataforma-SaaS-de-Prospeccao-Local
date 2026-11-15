'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Play, Plus, Send } from 'lucide-react';
import { ConsoleShell } from '@/components/ConsoleShell';
import { apiFetch } from '@/lib/api-client';

interface LeadRow {
  id: string;
  businessName: string;
  whatsappValid: boolean | null;
  optedOut: boolean;
  lastContactedAt: string | null;
  phoneE164: string | null;
}

interface ConnectionRow {
  id: string;
  label: string;
  channel: string;
  status: string;
}

interface TemplateRow {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
}

interface CampaignRow {
  id: string;
  name: string;
  channel: string;
  status: string;
  totalTargets: number;
  sentCount: number;
  blockedCount: number;
}

const VARIABLES = [
  '{{nome_empresa}}',
  '{{categoria}}',
  '{{bairro}}',
  '{{cidade}}',
  '{{link_preview}}',
  '{{link_optout}}',
  '{{nota_google}}',
];

export default function CampaignsPage() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);

  const [name, setName] = useState('Campanha Prospecção Local');
  const [connectionId, setConnectionId] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState(
    '{Olá|Oi}, equipe da {{nome_empresa}}! Vi sua avaliação {{nota_google}}★ em {{bairro}} ({{categoria}}) e preparamos uma prévia de site: {{link_preview}} — Descadastro: {{link_optout}}',
  );
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [minDelayMs, setMinDelayMs] = useState(500);
  const [respectBusinessHours, setRespectBusinessHours] = useState(false);
  const [spintaxPreview, setSpintaxPreview] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadAll = async () => {
    const [l, c, t, camp] = await Promise.all([
      apiFetch<{ leads: LeadRow[] }>('/api/leads'),
      apiFetch<{ connections: ConnectionRow[] }>('/api/connections'),
      apiFetch<{ templates: TemplateRow[] }>('/api/message-templates'),
      apiFetch<{ campaigns: CampaignRow[] }>('/api/campaigns'),
    ]);
    setLeads(l.leads);
    setConnections(c.connections);
    setTemplates(t.templates);
    setCampaigns(camp.campaigns);
    const activeWa = c.connections.find(
      (cn) => cn.channel.startsWith('WHATSAPP') && cn.status === 'CONNECTED',
    );
    if (activeWa && !connectionId) setConnectionId(activeWa.id);
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const previewSpintax = async () => {
    const res = await apiFetch<{ rendered: string }>('/api/message-templates/preview', {
      method: 'POST',
      json: { template: bodyTemplate },
    });
    setSpintaxPreview(res.rendered);
  };

  const toggleLead = (id: string) => {
    setSelectedLeadIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const launchCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!connectionId) {
      setError('Selecione uma conexão WhatsApp ativa.');
      return;
    }
    if (selectedLeadIds.length === 0) {
      setError('Selecione ao menos um lead.');
      return;
    }

    try {
      const res = await apiFetch<{ summary: { queued: number; blocked: number } }>('/api/campaigns', {
        method: 'POST',
        json: {
          name,
          channel: 'WHATSAPP',
          connectionId,
          bodyTemplate,
          leadIds: selectedLeadIds,
          minDelayMs,
          maxDelayMs: minDelayMs + 250,
          respectBusinessHours,
          waitForCompletion: selectedLeadIds.length <= 15 && minDelayMs <= 1000,
        },
      });
      setNotice(
        `Campanha iniciada! ${res.summary.queued} enfileirados e ${res.summary.blocked} bloqueados por governança (Opt-out/Quarentena/WhatsApp).`,
      );
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <ConsoleShell
      title="Campanhas, Templates Dinâmicos & Cadência (RF-14 a RF-16)"
      subtitle="Monte roteiros com variáveis dinâmicas + spintax e dispare respeitando cadência e quarentena."
    >
      <div className="space-y-6">
        {notice && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={launchCampaign} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h2 className="font-bold text-slate-900">Roteiro com Spintax e Variáveis</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome da Campanha
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Conexão de Envio
                </label>
                <select
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="">Selecione...</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.status})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {templates.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setBodyTemplate(t.body)}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-700"
                  >
                    Usar: {t.name}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setBodyTemplate((prev) => `${prev} ${v}`)}
                  className="px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-mono hover:bg-indigo-100"
                >
                  <Plus className="w-3 h-3 inline" /> {v}
                </button>
              ))}
            </div>

            <textarea
              rows={4}
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 p-3 text-sm"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={previewSpintax}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1"
              >
                <Play className="w-3.5 h-3.5" /> Testar Spintax & Variáveis
              </button>

              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5">
                  Intervalo mín (ms):
                  <input
                    type="number"
                    min={50}
                    value={minDelayMs}
                    onChange={(e) => setMinDelayMs(Number(e.target.value))}
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={respectBusinessHours}
                    onChange={(e) => setRespectBusinessHours(e.target.checked)}
                  />
                  Janela 08h30–18h
                </label>
              </div>
            </div>

            {spintaxPreview && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                <strong className="block text-[11px] uppercase text-slate-500 mb-1">
                  Prévia Renderizada:
                </strong>
                {spintaxPreview}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm inline-flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" /> Enfileirar Campanha em Lote ({selectedLeadIds.length}{' '}
              selecionados)
            </button>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-3 max-h-[540px] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Selecionar Leads</h2>
              <button
                type="button"
                onClick={() => setSelectedLeadIds(leads.map((l) => l.id))}
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                Selecionar todos
              </button>
            </div>

            {leads.map((lead) => {
              const blockedReason = lead.optedOut
                ? 'Opt-out ativo'
                : !lead.whatsappValid
                  ? 'Sem WhatsApp'
                  : null;
              return (
                <label
                  key={lead.id}
                  className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selectedLeadIds.includes(lead.id)}
                    onChange={() => toggleLead(lead.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 truncate">{lead.businessName}</p>
                    <p className="text-slate-500">{lead.phoneE164 || 'Sem telefone'}</p>
                  </div>
                  {blockedReason ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-semibold">
                      <AlertTriangle className="w-3 h-3" /> {blockedReason}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
                      Apto
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </form>

        {/* Lista de Campanhas */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <h2 className="font-bold text-slate-900 mb-4">Histórico de Campanhas</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
                <tr>
                  <th className="py-2.5 px-3">Campanha</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Alvos</th>
                  <th className="py-2.5 px-3">Enviados</th>
                  <th className="py-2.5 px-3">Bloqueados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2.5 px-3 font-semibold">{c.name}</td>
                    <td className="py-2.5 px-3">{c.status}</td>
                    <td className="py-2.5 px-3">{c.totalTargets}</td>
                    <td className="py-2.5 px-3 text-emerald-700 font-bold">{c.sentCount}</td>
                    <td className="py-2.5 px-3 text-rose-600 font-bold">{c.blockedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ConsoleShell>
  );
}

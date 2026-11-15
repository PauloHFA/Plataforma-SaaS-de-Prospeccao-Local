'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Kanban,
  List,
  MessageCircle,
  Send,
  ShieldOff,
  Sparkles,
  X,
} from 'lucide-react';
import { ConsoleShell } from '@/components/ConsoleShell';
import { apiFetch } from '@/lib/api-client';
import {
  FUNNEL_STAGE_LABELS,
  FUNNEL_STAGES,
  type FunnelStage,
} from '@plataforma/shared';

interface PipelineLead {
  id: string;
  businessName: string;
  category: string;
  neighborhood: string;
  city: string;
  phoneE164: string | null;
  phoneRaw: string | null;
  whatsappValid: boolean | null;
  websiteCategory: string;
  funnelStage: FunnelStage;
  optedOut: boolean;
  rating: number;
  site: {
    id: string;
    subdomainSlug: string;
    status: string;
    previewViewsCount: number;
    whatsappClicksCount: number;
  } | null;
}

interface LeadDetailData {
  lead: PipelineLead & { address: string; optOutReason: string | null };
  sites?: Array<{
    id: string;
    subdomainSlug: string;
    status: string;
    previewViewsCount: number;
    whatsappClicksCount: number;
  }>;
  notes: Array<{ id: string; content: string; createdAt: string }>;
  dispatches: Array<{
    id: string;
    channel: string;
    status: string;
    renderedBody: string;
    blockReason: string | null;
    createdAt: string;
  }>;
}

export default function PipelinePage() {
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [selectedLead, setSelectedLead] = useState<LeadDetailData | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [quickMsg, setQuickMsg] = useState(
    'Olá, equipe da {{nome_empresa}}! Montamos uma prévia exclusiva para vocês em {{bairro}}: {{link_preview}} (Descadastro: {{link_optout}})',
  );
  const [actionNotice, setActionNotice] = useState('');

  const loadLeads = async () => {
    const res = await apiFetch<{ leads: PipelineLead[] }>('/api/leads');
    setLeads(res.leads);
  };

  useEffect(() => {
    void loadLeads();
  }, []);

  const moveStage = async (leadId: string, stage: FunnelStage) => {
    await apiFetch(`/api/leads/${leadId}`, {
      method: 'PATCH',
      json: { funnelStage: stage },
    });
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, funnelStage: stage } : l)));
    if (selectedLead?.lead.id === leadId) {
      setSelectedLead({
        ...selectedLead,
        lead: { ...selectedLead.lead, funnelStage: stage },
      });
    }
  };

  const openDetail = async (leadId: string) => {
    setActionNotice('');
    const data = await apiFetch<LeadDetailData>(`/api/leads/${leadId}`);
    setSelectedLead(data);
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead || !noteInput.trim()) return;
    await apiFetch(`/api/leads/${selectedLead.lead.id}/notes`, {
      method: 'POST',
      json: { content: noteInput },
    });
    setNoteInput('');
    await openDetail(selectedLead.lead.id);
  };

  const sendQuickWhatsApp = async () => {
    if (!selectedLead) return;
    setActionNotice('');
    try {
      await apiFetch('/api/campaigns/send-single', {
        method: 'POST',
        json: {
          leadId: selectedLead.lead.id,
          channel: 'WHATSAPP',
          bodyTemplate: quickMsg,
          respectBusinessHours: false,
        },
      });
      setActionNotice('Mensagem enviada com sucesso!');
      await openDetail(selectedLead.lead.id);
      await loadLeads();
    } catch (err: any) {
      setActionNotice(`Bloqueado: ${err.message}`);
    }
  };

  const markOptOut = async () => {
    if (!selectedLead) return;
    await apiFetch(`/api/leads/${selectedLead.lead.id}/opt-out`, {
      method: 'POST',
      json: { reason: 'Marcado pelo operador no detalhe do funil.' },
    });
    await openDetail(selectedLead.lead.id);
    await loadLeads();
  };

  return (
    <ConsoleShell
      title="Funil de Prospecção (RF-06)"
      subtitle="Alterne entre quadro Kanban (7 estágios) e lista detalhada com histórico de interações."
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-white border border-slate-200 p-1">
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              data-testid="pipeline-kanban-tab"
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                viewMode === 'kanban' ? 'bg-slate-900 text-white' : 'text-slate-600'
              }`}
            >
              <Kanban className="w-3.5 h-3.5" /> Quadro Kanban
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              data-testid="pipeline-list-tab"
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                viewMode === 'list' ? 'bg-slate-900 text-white' : 'text-slate-600'
              }`}
            >
              <List className="w-3.5 h-3.5" /> Lista
            </button>
          </div>
        </div>

        {viewMode === 'kanban' ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {FUNNEL_STAGES.map((stage) => {
              const stageLeads = leads.filter((l) => l.funnelStage === stage);
              return (
                <div
                  key={stage}
                  data-testid={`kanban-col-${stage}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData('text/plain');
                    if (id) void moveStage(id, stage);
                  }}
                  className="w-72 shrink-0 bg-slate-100/80 border border-slate-200 rounded-2xl p-3 flex flex-col gap-3 min-h-[420px]"
                >
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                      {FUNNEL_STAGE_LABELS[stage]}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-white text-slate-700 text-xs font-bold border border-slate-200">
                      {stageLeads.length}
                    </span>
                  </div>

                  <div className="space-y-2.5 flex-1">
                    {stageLeads.map((lead) => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', lead.id)}
                        onClick={() => openDetail(lead.id)}
                        data-testid={`kanban-card-${lead.id}`}
                        className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm cursor-pointer hover:border-indigo-400 transition space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-bold text-xs text-slate-900 leading-snug">
                            {lead.businessName}
                          </p>
                          {lead.whatsappValid && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {lead.neighborhood} · {lead.city}
                        </p>
                        {lead.site && (
                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 text-slate-600">
                            <span className="font-medium text-indigo-600">
                              {lead.site.status}
                            </span>
                            <span>
                              {lead.site.previewViewsCount} views · {lead.site.whatsappClicksCount} clq
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
                <tr>
                  <th className="py-3 px-4">Empresa</th>
                  <th className="py-3 px-4">Estágio</th>
                  <th className="py-3 px-4">WhatsApp</th>
                  <th className="py-3 px-4">Site</th>
                  <th className="py-3 px-4 text-right">Mover</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50">
                    <td
                      className="py-3 px-4 font-semibold text-slate-900 cursor-pointer hover:text-indigo-600"
                      onClick={() => openDetail(lead.id)}
                    >
                      {lead.businessName}
                      <span className="block text-xs font-normal text-slate-500">
                        {lead.neighborhood}, {lead.city}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold">
                      {FUNNEL_STAGE_LABELS[lead.funnelStage]}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {lead.whatsappValid ? 'Verificado' : 'Indisponível'}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {lead.site ? (
                        <Link
                          href={`/sites/${lead.site.id}/editor`}
                          className="text-indigo-600 font-semibold hover:underline"
                        >
                          {lead.site.subdomainSlug}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <select
                        value={lead.funnelStage}
                        onChange={(e) => moveStage(lead.id, e.target.value as FunnelStage)}
                        className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white"
                      >
                        {FUNNEL_STAGES.map((st) => (
                          <option key={st} value={st}>
                            {FUNNEL_STAGE_LABELS[st]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drawer de Detalhe do Lead & Linha do Tempo (RF-16) */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="w-full max-w-lg bg-white h-full overflow-y-auto p-6 space-y-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {selectedLead.lead.businessName}
                </h2>
                <p className="text-xs text-slate-500">{selectedLead.lead.address}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLead(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <select
                value={selectedLead.lead.funnelStage}
                onChange={(e) => moveStage(selectedLead.lead.id, e.target.value as FunnelStage)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
              >
                {FUNNEL_STAGES.map((st) => (
                  <option key={st} value={st}>
                    {FUNNEL_STAGE_LABELS[st]}
                  </option>
                ))}
              </select>

              {!selectedLead.lead.optedOut ? (
                <button
                  type="button"
                  onClick={markOptOut}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 text-rose-700 text-xs font-semibold hover:bg-rose-50"
                >
                  <ShieldOff className="w-3.5 h-3.5" /> Bloquear (Opt-out)
                </button>
              ) : (
                <span className="px-3 py-1 rounded-full bg-rose-100 text-rose-700 text-xs font-bold">
                  Opt-out Ativo
                </span>
              )}
            </div>

            {(() => {
              const drawerSite = selectedLead.lead.site ?? selectedLead.sites?.[0] ?? null;
              return drawerSite ? (
                <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-between gap-3">
                  <div className="text-xs">
                    <p className="font-bold text-indigo-950">Site SPA Gerado</p>
                    <p className="text-indigo-700">/preview/{drawerSite.subdomainSlug}</p>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/sites/${drawerSite.id}/editor`}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold"
                    >
                      Editor
                    </Link>
                    <a
                      href={`/preview/${drawerSite.subdomainSlug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-white border border-indigo-200 text-indigo-700 text-xs font-semibold inline-flex items-center gap-1"
                    >
                      Abrir <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ) : (
                <Link
                  href="/leads"
                  className="block p-3 rounded-xl border border-dashed border-slate-300 text-center text-xs font-semibold text-indigo-600 hover:bg-slate-50"
                >
                  <Sparkles className="w-4 h-4 inline mr-1" /> Gerar Site SPA na aba de Captação
                </Link>
              );
            })()}

            {/* Disparo Individual Rápido */}
            <div className="space-y-2 border-t border-slate-200 pt-4">
              <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <MessageCircle className="w-4 h-4 text-emerald-600" /> Disparo Rápido WhatsApp
              </p>
              <textarea
                rows={3}
                value={quickMsg}
                onChange={(e) => setQuickMsg(e.target.value)}
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs"
              />
              {actionNotice && (
                <p className="text-xs font-semibold text-indigo-700">{actionNotice}</p>
              )}
              <button
                type="button"
                disabled={!selectedLead.lead.whatsappValid || selectedLead.lead.optedOut}
                onClick={sendQuickWhatsApp}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold"
              >
                <Send className="w-3.5 h-3.5" />
                {selectedLead.lead.whatsappValid
                  ? 'Enviar Mensagem Agora'
                  : 'WhatsApp indisponível / não verificado'}
              </button>
            </div>

            {/* Anotações Comerciais */}
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <p className="text-xs font-bold text-slate-800">Anotações Comerciais (RF-16)</p>
              <form onSubmit={addNote} className="flex gap-2">
                <input
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Registrar feedback ou objeção do cliente..."
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs"
                />
                <button
                  type="submit"
                  className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold"
                >
                  Salvar
                </button>
              </form>
              <div className="space-y-2">
                {selectedLead.notes.map((n) => (
                  <div key={n.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <p className="text-slate-800">{n.content}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Histórico de Disparos */}
            <div className="space-y-2 border-t border-slate-200 pt-4">
              <p className="text-xs font-bold text-slate-800">Histórico de Mensagens</p>
              {selectedLead.dispatches.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma mensagem enviada ainda.</p>
              ) : (
                <div className="space-y-2">
                  {selectedLead.dispatches.map((d) => (
                    <div
                      key={d.id}
                      className="p-3 rounded-xl border border-slate-200 text-xs space-y-1"
                    >
                      <div className="flex justify-between font-bold">
                        <span>{d.channel}</span>
                        <span className="text-indigo-700">{d.status}</span>
                      </div>
                      <p className="text-slate-600">{d.renderedBody}</p>
                      {d.blockReason && <p className="text-rose-600">{d.blockReason}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </ConsoleShell>
  );
}

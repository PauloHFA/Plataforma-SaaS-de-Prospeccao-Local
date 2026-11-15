'use client';

import { useEffect, useState } from 'react';
import { Activity, RefreshCw, Shield, Users } from 'lucide-react';
import { ConsoleShell } from '@/components/ConsoleShell';
import { apiFetch } from '@/lib/api-client';

interface QueueMetric {
  name: string;
  driver: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  dlqCount: number;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  creditsBalance: number;
}

interface TemplateRow {
  id: string;
  slug: string;
  name: string;
  niche: string;
  isActive: boolean;
}

interface AuditRow {
  id: string;
  actorRole: string;
  action: string;
  resourceType: string;
  createdAt: string;
}

export default function GlobalAdminPage() {
  const [overview, setOverview] = useState<{
    metrics: Record<string, number>;
    queues: QueueMetric[];
  } | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);

  const loadAll = async () => {
    const [ov, tn, tp, au] = await Promise.all([
      apiFetch<{ metrics: Record<string, number>; queues: QueueMetric[] }>('/api/admin/overview'),
      apiFetch<{ tenants: TenantRow[] }>('/api/admin/tenants'),
      apiFetch<{ templates: TemplateRow[] }>('/api/admin/templates'),
      apiFetch<{ logs: AuditRow[] }>('/api/admin/audit-logs'),
    ]);
    setOverview(ov);
    setTenants(tn.tenants);
    setTemplates(tp.templates);
    setAuditLogs(au.logs);
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const retryQueue = async (name: string) => {
    await apiFetch(`/api/admin/queues/${name}/retry-failed`, { method: 'POST' });
    await loadAll();
  };

  const toggleTemplate = async (tpl: TemplateRow) => {
    await apiFetch(`/api/admin/templates/${tpl.id}`, {
      method: 'PATCH',
      json: { isActive: !tpl.isActive },
    });
    await loadAll();
  };

  const addCredits = async (t: TenantRow) => {
    await apiFetch(`/api/admin/tenants/${t.id}`, {
      method: 'PATCH',
      json: { creditsBalance: t.creditsBalance + 500 },
    });
    await loadAll();
  };

  return (
    <ConsoleShell
      title="Administração Global da Plataforma (RBAC)"
      subtitle="Gestão de workspaces, catálogo global de templates, filas BullMQ/DLQ e logs de auditoria."
      requireAdmin={true}
    >
      <div className="space-y-6">
        {overview && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <MetricBox label="Workspaces" value={overview.metrics.totalTenants ?? 0} />
            <MetricBox label="Leads Globais" value={overview.metrics.totalLeads ?? 0} />
            <MetricBox label="Sites Gerados" value={overview.metrics.totalSites ?? 0} />
            <MetricBox label="Publicados" value={overview.metrics.publishedSites ?? 0} />
            <MetricBox label="Tokens LLM" value={overview.metrics.totalLlmTokens ?? 0} />
          </div>
        )}

        {/* Saúde das Filas BullMQ / DLQ */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-600" /> Saúde das Filas & Dead-Letter Queues
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
                <tr>
                  <th className="py-2 px-3">Fila</th>
                  <th className="py-2 px-3">Driver</th>
                  <th className="py-2 px-3">Aguardando</th>
                  <th className="py-2 px-3">Agendados</th>
                  <th className="py-2 px-3">Concluídos</th>
                  <th className="py-2 px-3">DLQ (Falhos)</th>
                  <th className="py-2 px-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview?.queues.map((q) => (
                  <tr key={q.name}>
                    <td className="py-2.5 px-3 font-mono font-semibold">{q.name}</td>
                    <td className="py-2.5 px-3">{q.driver}</td>
                    <td className="py-2.5 px-3">{q.waiting}</td>
                    <td className="py-2.5 px-3">{q.delayed}</td>
                    <td className="py-2.5 px-3 text-emerald-700 font-bold">{q.completed}</td>
                    <td className="py-2.5 px-3 text-rose-600 font-bold">{q.dlqCount}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => retryQueue(q.name)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-semibold hover:bg-slate-50"
                      >
                        <RefreshCw className="w-3 h-3" /> Reprocessar DLQ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tenants */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-600" /> Workspaces (Tenants)
            </h2>
            {tenants.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
              >
                <div>
                  <p className="font-bold text-slate-900">{t.name}</p>
                  <p className="text-slate-500">
                    {t.slug} · {t.creditsBalance} créditos
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => addCredits(t)}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold"
                >
                  +500 Créditos
                </button>
              </div>
            ))}
          </div>

          {/* Catálogo Global de Templates */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-600" /> Catálogo Global de Templates SPA
            </h2>
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
              >
                <div>
                  <p className="font-bold text-slate-900">{tpl.name}</p>
                  <p className="text-slate-500">
                    {tpl.slug} · Nicho: {tpl.niche}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleTemplate(tpl)}
                  className={`px-3 py-1 rounded-full font-bold ${
                    tpl.isActive
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {tpl.isActive ? 'Ativo' : 'Desativado'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Logs de Auditoria */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
          <h2 className="font-bold text-slate-900">Logs de Auditoria Recentes</h2>
          <div className="space-y-1.5 max-h-72 overflow-y-auto text-xs">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100"
              >
                <span className="font-mono font-semibold text-slate-800">{log.action}</span>
                <span className="text-slate-500">
                  {log.actorRole} · {log.resourceType}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ConsoleShell>
  );
}

function MetricBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
      <p className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">
        {value.toLocaleString('pt-BR')}
      </p>
    </div>
  );
}

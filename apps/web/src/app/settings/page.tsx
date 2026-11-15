'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Shield, Trash2 } from 'lucide-react';
import { ConsoleShell, type WorkspaceUsage } from '@/components/ConsoleShell';
import { apiFetch } from '@/lib/api-client';

interface SecretInfo {
  id: string;
  provider: string;
  keyHint: string;
  isActive: boolean;
}

const PROVIDERS = [
  { id: 'google_places', label: 'Google Places API (BYOK)' },
  { id: 'openai', label: 'OpenAI API Key (BYOK)' },
  { id: 'anthropic', label: 'Anthropic API Key (BYOK)' },
  { id: 'stripe', label: 'Stripe Secret Key (Checkout)' },
  { id: 'asaas', label: 'Asaas API Key (Checkout)' },
];

export default function SettingsPage() {
  const [secrets, setSecrets] = useState<SecretInfo[]>([]);
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [provider, setProvider] = useState('openai');
  const [secretValue, setSecretValue] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    const [s, u] = await Promise.all([
      apiFetch<{ secrets: SecretInfo[] }>('/api/settings/secrets'),
      apiFetch<WorkspaceUsage>('/api/settings/usage'),
    ]);
    setSecrets(s.secrets);
    setUsage(u);
  };

  useEffect(() => {
    void load();
  }, []);

  const saveSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice('');
    await apiFetch(`/api/settings/secrets/${provider}`, {
      method: 'PUT',
      json: { secretValue },
    });
    setSecretValue('');
    setNotice('Chave criptografada com AES-256-GCM e armazenada com segurança!');
    await load();
  };

  const deleteSecret = async (p: string) => {
    await apiFetch(`/api/settings/secrets/${p}`, { method: 'DELETE' });
    await load();
  };

  return (
    <ConsoleShell
      title="Chaves BYOK (AES-256) e Telemetria de Custos (RNF-04, RNF-07, RN-09)"
      subtitle="Configure suas próprias chaves de API criptografadas ou monitore o consumo da franquia."
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-indigo-600" />
            <h2 className="font-bold text-slate-900">Cofre de Chaves BYOK (AES-256-GCM)</h2>
          </div>

          {notice && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          <form onSubmit={saveSecret} className="space-y-3">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              type="password"
              required
              minLength={6}
              placeholder="Cole sua chave secreta aqui..."
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono"
            />
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold"
            >
              Criptografar e Salvar Chave
            </button>
          </form>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <p className="text-xs font-bold text-slate-600">Chaves Configuradas no Workspace</p>
            {secrets.length === 0 ? (
              <p className="text-xs text-slate-500">Usando créditos e chaves da franquia SaaS.</p>
            ) : (
              secrets.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                >
                  <div>
                    <span className="font-bold text-slate-900">{s.provider}</span>
                    <span className="ml-2 font-mono text-slate-500">{s.keyHint}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteSecret(s.provider)}
                    className="text-rose-600 hover:underline inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remover
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-600" />
            <h2 className="font-bold text-slate-900">Observabilidade e Custos Mensais (RNF-07)</h2>
          </div>

          {usage && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-xs text-slate-500">Buscas Mapas (Mês)</p>
                  <p className="text-xl font-bold text-slate-900">{usage.monthly.searches}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-xs text-slate-500">Sites Gerados (Mês)</p>
                  <p className="text-xl font-bold text-slate-900">
                    {usage.monthly.siteGenerations}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-xs text-slate-500">Tokens LLM</p>
                  <p className="text-xl font-bold text-slate-900">
                    {usage.monthly.totalTokens.toLocaleString('pt-BR')}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-xs text-slate-500">Orçamento Usado / Teto</p>
                  <p className="text-xl font-bold text-slate-900">
                    R$ {(usage.monthly.estimatedCostCents / 100).toFixed(2)} / R${' '}
                    {(usage.plan.monthlyBudgetCents / 100).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ConsoleShell>
  );
}

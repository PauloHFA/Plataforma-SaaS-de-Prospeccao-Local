'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Mail, Plus, QrCode, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { ConsoleShell } from '@/components/ConsoleShell';
import { apiFetch } from '@/lib/api-client';

interface ConnectionItem {
  id: string;
  channel: string;
  label: string;
  status: string;
  identifier: string;
  qrCodeData: string | null;
  spfVerified: boolean;
  dkimVerified: boolean;
  dailyLimit: number;
  sentToday: number;
}

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<ConnectionItem[]>([]);
  const [channel, setChannel] = useState<'WHATSAPP_EVOLUTION' | 'WHATSAPP_META' | 'EMAIL_SMTP'>(
    'WHATSAPP_EVOLUTION',
  );
  const [label, setLabel] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    const res = await apiFetch<{ connections: ConnectionItem[] }>('/api/connections');
    setConnections(res.connections);
  };

  useEffect(() => {
    void load();
  }, []);

  const createConn = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice('');
    await apiFetch('/api/connections', {
      method: 'POST',
      json: { channel, label, identifier },
    });
    setLabel('');
    setIdentifier('');
    setNotice('Conexão criada com sucesso!');
    await load();
  };

  const confirmQr = async (id: string) => {
    await apiFetch(`/api/connections/${id}/pair`, {
      method: 'POST',
      json: { action: 'confirm_paired', phone: '+5511999998888' },
    });
    setNotice('Instância WhatsApp pareada e conectada!');
    await load();
  };

  const verifyEmailDns = async (id: string) => {
    const res = await apiFetch<{ dns: { spfVerified: boolean; dkimVerified: boolean } }>(
      `/api/connections/${id}/verify-dns`,
      { method: 'POST' },
    );
    setNotice(
      `DNS verificado — SPF: ${res.dns.spfVerified ? 'OK' : 'Pendente'} · DKIM: ${res.dns.dkimVerified ? 'OK' : 'Pendente'}`,
    );
    await load();
  };

  const removeConn = async (id: string) => {
    await apiFetch(`/api/connections/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <ConsoleShell
      title="Conexões de Envio: WhatsApp & E-mail Autenticado (RF-13)"
      subtitle="Pareamento por QR Code (Evolution), API Oficial Meta ou remetente SMTP com SPF/DKIM."
    >
      <div className="space-y-6">
        {notice && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        <form
          onSubmit={createConn}
          className="bg-white border border-slate-200 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-end"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Canal</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as any)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="WHATSAPP_EVOLUTION">WhatsApp QR Code (Gateway)</option>
              <option value="WHATSAPP_META">WhatsApp API Oficial Meta</option>
              <option value="EMAIL_SMTP">E-mail Autenticado (SPF/DKIM)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Rótulo</label>
            <input
              required
              placeholder="Ex: WhatsApp Comercial 02"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {channel === 'EMAIL_SMTP' ? 'E-mail Remetente' : 'Número (+55...)'}
            </label>
            <input
              required
              placeholder={channel === 'EMAIL_SMTP' ? 'contato@suaagencia.com.br' : '+5511999990002'}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Adicionar Conexão
          </button>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                    {conn.channel === 'EMAIL_SMTP' ? (
                      <Mail className="w-5 h-5" />
                    ) : (
                      <Smartphone className="w-5 h-5 text-emerald-600" />
                    )}
                  </div>
                  <div>
                    <h2 className="font-bold text-slate-900">{conn.label}</h2>
                    <p className="text-xs text-slate-500">
                      {conn.channel} · {conn.identifier || 'Aguardando pareamento'}
                    </p>
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    conn.status === 'CONNECTED'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {conn.status}
                </span>
              </div>

              {conn.qrCodeData && conn.status === 'QR_PENDING' && (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-center gap-4">
                  <img
                    src={conn.qrCodeData}
                    alt="QR Code WhatsApp"
                    className="w-32 h-32 rounded-lg border border-slate-200 bg-white"
                  />
                  <div className="space-y-2 text-xs text-slate-600">
                    <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <QrCode className="w-4 h-4" /> Escaneie com seu WhatsApp
                    </p>
                    <p>Em ambiente sandbox/demonstração, confirme o pareamento abaixo.</p>
                    <button
                      type="button"
                      onClick={() => confirmQr(conn.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold"
                    >
                      Confirmar Pareamento Conectado
                    </button>
                  </div>
                </div>
              )}

              {conn.channel === 'EMAIL_SMTP' && (
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck
                        className={`w-4 h-4 ${conn.spfVerified ? 'text-emerald-600' : 'text-slate-400'}`}
                      />
                      SPF: {conn.spfVerified ? 'Autenticado' : 'Pendente'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck
                        className={`w-4 h-4 ${conn.dkimVerified ? 'text-emerald-600' : 'text-slate-400'}`}
                      />
                      DKIM: {conn.dkimVerified ? 'Autenticado' : 'Pendente'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => verifyEmailDns(conn.id)}
                    className="px-3 py-1 rounded-lg bg-slate-900 text-white font-semibold"
                  >
                    Verificar DNS
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                <span>
                  Enviados hoje: <strong>{conn.sentToday}</strong> / {conn.dailyLimit}
                </span>
                <button
                  type="button"
                  onClick={() => removeConn(conn.id)}
                  className="text-rose-600 hover:underline inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ConsoleShell>
  );
}

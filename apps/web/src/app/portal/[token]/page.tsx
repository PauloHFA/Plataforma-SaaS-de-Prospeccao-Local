'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, Globe, ImagePlus, Phone, Clock, Send, ShieldCheck } from 'lucide-react';
import { apiFetch, getApiBaseUrl } from '@/lib/api-client';
import type { SiteDocument } from '@plataforma/shared';

interface PortalData {
  site: {
    id: string;
    status: string;
    subdomainSlug: string;
    customDomain: string | null;
    contentJson: SiteDocument;
  };
  domain: {
    domain: string;
    dnsStatus: string;
    sslStatus: string;
  } | null;
  requests: Array<{
    id: string;
    requestType: string;
    message: string;
    status: string;
    createdAt: string;
  }>;
  transactions: Array<{
    id: string;
    billingModel: string;
    amountCents: number;
    status: string;
  }>;
  dnsInstructions: {
    cnameTarget: string;
    aRecord: string;
  };
}

export default function ClientPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [hoursText, setHoursText] = useState('');
  const [requestMsg, setRequestMsg] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await apiFetch<PortalData>(`/api/portal/${token}`);
      setData(res);
      setPhoneDisplay(res.site.contentJson.business.phoneDisplay);
      setWhatsappNumber(res.site.contentJson.business.whatsappNumber || '');
      setHoursText(
        res.site.contentJson.business.openingHours
          .map((h) => `${h.day}: ${h.hours}`)
          .join('\n'),
      );
    } catch (err: any) {
      setError(err.message || 'Portal não encontrado.');
    }
  };

  useEffect(() => {
    if (token) void load();
  }, [token]);

  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotice('');
    const openingHours = hoursText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 7)
      .map((line) => {
        const [day, ...rest] = line.split(':');
        return { day: (day || 'Dia').trim(), hours: rest.join(':').trim() || '08:00 - 18:00' };
      });

    await apiFetch(`/api/portal/${token}/site`, {
      method: 'PATCH',
      json: { phoneDisplay, whatsappNumber, openingHours },
    });
    setSavedNotice('Dados de contato e horários atualizados com sucesso!');
    await load();
  };

  const handleSendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestMsg.trim()) return;
    await apiFetch(`/api/portal/${token}/requests`, {
      method: 'POST',
      json: { requestType: 'CONTENT_ADJUSTMENT', message: requestMsg },
    });
    setRequestMsg('');
    setSavedNotice('Solicitação de ajuste enviada à agência!');
    await load();
  };

  const handleSubscription = async (action: 'CANCEL' | 'REACTIVATE') => {
    await apiFetch(`/api/portal/${token}/subscription`, {
      method: 'POST',
      json: { action },
    });
    await load();
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setUploadError('');
    setSavedNotice('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(`${getApiBaseUrl()}/api/portal/${token}/media`, {
        method: 'POST',
        body: formData,
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setUploadError(json?.error || 'Não foi possível enviar a foto.');
        return;
      }
      setSavedNotice('Imagem principal atualizada e convertida para WebP com sucesso!');
      await load();
    } catch {
      setUploadError('Falha ao enviar imagem para o servidor.');
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md text-center">
          <h1 className="font-bold text-lg text-slate-900 mb-2">Acesso Inválido</h1>
          <p className="text-sm text-slate-600">{error}</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="text-sm text-slate-500">Carregando Portal do Cliente...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
              Portal Simplificado do Cliente (RF-20)
            </p>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">
              {data.site.contentJson.business.name}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Status do site:{' '}
              <span className="font-semibold text-emerald-700">{data.site.status}</span>
            </p>
          </div>
          <a
            href={`/preview/${data.site.subdomainSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
          >
            Visualizar Meu Site
          </a>
        </header>

        {savedNotice && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{savedNotice}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <form
              onSubmit={handleSaveInfo}
              className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4"
            >
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <Phone className="w-4 h-4 text-indigo-600" />
                Atualizar Telefone e Horários
              </h2>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Telefone Exibido
                </label>
                <input
                  value={phoneDisplay}
                  onChange={(e) => setPhoneDisplay(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  WhatsApp (E.164 ex: +5511999990000)
                </label>
                <input
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Horários (um por linha: Dia: Horário)
                </label>
                <textarea
                  rows={5}
                  value={hoursText}
                  onChange={(e) => setHoursText(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500"
              >
                Salvar Alterações no Site
              </button>
            </form>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <ImagePlus className="w-4 h-4 text-indigo-600" />
                Atualizar Foto Principal (WebP)
              </h2>
              <p className="text-xs text-slate-600">
                Envie uma nova imagem da fachada ou ambiente; ela é otimizada automaticamente para carregamento rápido.
              </p>
              <div className="h-32 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                <img
                  src={
                    data.site.contentJson.hero.heroImageUrl.startsWith('/api/media/')
                      ? `${getApiBaseUrl()}${data.site.contentJson.hero.heroImageUrl}`
                      : data.site.contentJson.hero.heroImageUrl
                  }
                  alt={data.site.contentJson.business.name}
                  className="w-full h-full object-cover"
                />
              </div>
              {uploadError && <p className="text-xs text-rose-600 font-medium">{uploadError}</p>}
              <label className="inline-flex items-center justify-center w-full gap-2 px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 cursor-pointer hover:bg-slate-50">
                <ImagePlus className="w-4 h-4 text-indigo-600" />
                {uploadingPhoto ? 'Otimizando imagem...' : 'Enviar Nova Foto Principal'}
                <input
                  type="file"
                  accept="image/*"
                  data-testid="portal-photo-upload-input"
                  disabled={uploadingPhoto}
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-600" />
                Apontamento de Domínio Próprio
              </h2>
              <p className="text-xs text-slate-600">
                Para usar seu próprio domínio, crie os registros abaixo no seu provedor DNS:
              </p>
              <div className="bg-slate-50 rounded-xl p-3 text-xs font-mono space-y-1 border border-slate-200">
                <p>CNAME (www) → {data.dnsInstructions.cnameTarget}</p>
                <p>A (@) → {data.dnsInstructions.aRecord}</p>
              </div>
              {data.domain && (
                <p className="text-xs text-slate-700">
                  Domínio configurado: <strong>{data.domain.domain}</strong> · DNS:{' '}
                  <strong>{data.domain.dnsStatus}</strong> · SSL:{' '}
                  <strong>{data.domain.sslStatus}</strong>
                </p>
              )}
            </div>

            <form
              onSubmit={handleSendRequest}
              className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3"
            >
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <Send className="w-4 h-4 text-indigo-600" />
                Solicitar Ajuste Básico
              </h2>
              <textarea
                rows={3}
                data-testid="portal-request-textarea"
                placeholder="Descreva o ajuste desejado no texto ou fotos..."
                value={requestMsg}
                onChange={(e) => setRequestMsg(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                data-testid="portal-request-submit-btn"
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
              >
                Enviar Solicitação
              </button>
            </form>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Gerenciar Assinatura
              </h2>
              <div className="flex items-center gap-3">
                {data.site.status === 'PUBLISHED' ? (
                  <button
                    type="button"
                    onClick={() => handleSubscription('CANCEL')}
                    className="px-4 py-2 rounded-lg border border-rose-200 text-rose-700 text-xs font-semibold hover:bg-rose-50"
                  >
                    Pausar / Cancelar Assinatura
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSubscription('REACTIVATE')}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500"
                  >
                    Reativar Site Agora
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, CreditCard, ExternalLink, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';

interface CheckoutData {
  offer: {
    id: string;
    token: string;
    gateway: string;
    billingModel: string;
    title: string;
    description: string;
    setupAmountCents: number;
    monthlyAmountCents: number;
    status: string;
  };
  businessName: string;
  siteStatus: string;
  subdomainSlug: string;
  previewUrl: string | null;
  clientPortalUrl: string | null;
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function PublicCheckoutPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<CheckoutData | null>(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [activatedResult, setActivatedResult] = useState<{
    clientPortalUrl?: string;
  } | null>(null);

  const load = async () => {
    try {
      const res = await apiFetch<CheckoutData>(`/api/public/checkout/${token}`);
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Oferta de checkout não encontrada.');
    }
  };

  useEffect(() => {
    if (token) void load();
  }, [token]);

  const handlePay = async () => {
    setPaying(true);
    setError('');
    try {
      const res = await apiFetch<{ activated?: boolean; clientPortalUrl?: string }>(
        `/api/public/checkout/${token}/pay`,
        { method: 'POST', json: { method: 'PIX_OR_CARD' } },
      );
      setActivatedResult(res);
      await load();
    } catch (err: any) {
      setError(err.message || 'Erro ao confirmar pagamento.');
    } finally {
      setPaying(false);
    }
  };

  if (error && !data) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <h1 className="text-xl font-bold text-slate-900 mb-2">Link Indisponível</h1>
          <p className="text-sm text-slate-600">{error}</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="text-sm text-slate-500">Carregando checkout seguro...</p>
      </main>
    );
  }

  const isPaid = data.offer.status === 'PAID' || data.siteStatus === 'PUBLISHED';

  return (
    <main className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 text-slate-700 text-sm font-medium">
            <Lock className="w-4 h-4 text-emerald-600" />
            <span>Checkout Seguro · {data.offer.gateway}</span>
          </div>
          {data.previewUrl && (
            <a
              href={data.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1"
            >
              Ver site em produção/prévia <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-900 text-white p-6 sm:p-8">
            <p className="text-xs uppercase tracking-wider text-indigo-300 font-semibold mb-1">
              Proposta Comercial · {data.businessName}
            </p>
            <h1 className="text-2xl font-bold">{data.offer.title}</h1>
            <p className="text-sm text-slate-300 mt-2">{data.offer.description}</p>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 space-y-3">
              {data.offer.setupAmountCents > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Taxa única de implantação e personalização</span>
                  <span className="font-bold text-slate-900">
                    {formatBRL(data.offer.setupAmountCents)}
                  </span>
                </div>
              )}
              {data.offer.monthlyAmountCents > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Hospedagem CDN, SSL e suporte mensal</span>
                  <span className="font-bold text-slate-900">
                    {formatBRL(data.offer.monthlyAmountCents)} / mês
                  </span>
                </div>
              )}
              <div className="border-t border-slate-200 pt-3 flex items-center justify-between">
                <span className="font-semibold text-slate-900">Total inicial hoje</span>
                <span className="text-2xl font-extrabold text-indigo-600">
                  {formatBRL(data.offer.setupAmountCents + data.offer.monthlyAmountCents)}
                </span>
              </div>
            </div>

            {isPaid ? (
              <div
                data-testid="checkout-paid-success"
                className="rounded-xl bg-emerald-50 border border-emerald-200 p-6 space-y-4"
              >
                <div className="flex items-center gap-3 text-emerald-800">
                  <CheckCircle2 className="w-6 h-6 shrink-0" />
                  <div>
                    <h2 className="font-bold text-base">Pagamento Confirmado e Site Publicado!</h2>
                    <p className="text-xs text-emerald-700">
                      O aviso de demonstração foi removido automaticamente e o site já está em Produção Ativa.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  {data.previewUrl && (
                    <a
                      href={data.previewUrl}
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500"
                    >
                      Abrir Site Publicado
                    </a>
                  )}
                  {(activatedResult?.clientPortalUrl || data.clientPortalUrl) && (
                    <a
                      href={activatedResult?.clientPortalUrl || data.clientPortalUrl || '#'}
                      className="px-4 py-2 rounded-lg bg-white border border-emerald-300 text-emerald-800 text-sm font-semibold hover:bg-emerald-100"
                    >
                      Acessar Portal do Cliente
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {error && (
                  <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handlePay}
                  disabled={paying}
                  data-testid="confirm-payment-btn"
                  className="w-full py-3.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold text-base flex items-center justify-center gap-2 transition"
                >
                  <CreditCard className="w-5 h-5" />
                  {paying ? 'Confirmando pagamento...' : 'Confirmar Pagamento e Ativar Site Agora'}
                </button>
                <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" /> Ativação automática imediata
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="w-4 h-4 text-indigo-500" /> Remoção instantânea da barra de prévia
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

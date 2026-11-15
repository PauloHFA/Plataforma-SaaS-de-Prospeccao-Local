'use client';

import { useEffect, useState } from 'react';
import { CreditCard, ExternalLink, Globe, ShieldCheck } from 'lucide-react';
import { ConsoleShell } from '@/components/ConsoleShell';
import { apiFetch } from '@/lib/api-client';

interface OfferItem {
  id: string;
  token: string;
  title: string;
  gateway: string;
  billingModel: string;
  setupAmountCents: number;
  monthlyAmountCents: number;
  status: string;
}

interface DomainItem {
  id: string;
  siteId: string;
  domain: string;
  expectedCname: string;
  dnsStatus: string;
  sslStatus: string;
}

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function BillingPage() {
  const [offers, setOffers] = useState<OfferItem[]>([]);
  const [domains, setDomains] = useState<DomainItem[]>([]);

  const load = async () => {
    const res = await apiFetch<{ offers: OfferItem[]; domains: DomainItem[] }>('/api/checkout/offers');
    setOffers(res.offers);
    setDomains(res.domains);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <ConsoleShell
      title="Checkout, Recebimentos e Domínios Customizados (RF-17 a RF-19)"
      subtitle="Acompanhe links de pagamento emitidos, ativações automáticas via webhook e SSL."
    >
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-indigo-600" /> Links de Checkout Emitidos
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
                <tr>
                  <th className="py-2.5 px-3">Oferta</th>
                  <th className="py-2.5 px-3">Modelo</th>
                  <th className="py-2.5 px-3">Setup</th>
                  <th className="py-2.5 px-3">Mensal</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {offers.map((o) => (
                  <tr key={o.id}>
                    <td className="py-2.5 px-3 font-semibold">{o.title}</td>
                    <td className="py-2.5 px-3">{o.billingModel}</td>
                    <td className="py-2.5 px-3">{formatBRL(o.setupAmountCents)}</td>
                    <td className="py-2.5 px-3">{formatBRL(o.monthlyAmountCents)}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          o.status === 'PAID'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <a
                        href={`/checkout/${o.token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-600 font-semibold hover:underline"
                      >
                        Abrir <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </td>
                  </tr>
                ))}
                {offers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      Nenhum checkout gerado ainda. Gere links na tela do Editor do Site.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <Globe className="w-4 h-4 text-emerald-600" /> Domínios Próprios e Certificados SSL
          </h2>
          {domains.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhum domínio customizado vinculado ainda.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {domains.map((d) => (
                <div
                  key={d.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-1.5"
                >
                  <p className="font-bold text-slate-900 text-sm">{d.domain}</p>
                  <p className="text-slate-600">CNAME esperado: {d.expectedCname}</p>
                  <div className="flex items-center gap-3 pt-1">
                    <span className="inline-flex items-center gap-1 font-semibold">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> DNS: {d.dnsStatus}
                    </span>
                    <span className="font-semibold">SSL: {d.sslStatus}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ConsoleShell>
  );
}

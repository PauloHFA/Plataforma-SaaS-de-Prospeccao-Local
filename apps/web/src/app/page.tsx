import Link from 'next/link';
import {
  ArrowRight,
  Compass,
  CreditCard,
  Globe,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export default function HomePage() {
  const steps = [
    {
      icon: Compass,
      title: '1. Captação Georreferenciada',
      desc: 'Localize empresas sem website ou com apenas Instagram/Linktree por cidade, bairro, CEP ou raio em km.',
    },
    {
      icon: ShieldCheck,
      title: '2. Higienização & WhatsApp',
      desc: 'Padronização E.164, detecção de linha móvel vs fixa, validação WhatsApp e deduplicação inteligente.',
    },
    {
      icon: Sparkles,
      title: '3. Geração SPA Schema-Driven',
      desc: 'IA redige copywriting validado por contrato Zod, injeta provas sociais e publica prévia instantânea.',
    },
    {
      icon: MessageSquare,
      title: '4. Disparo & Telemetria',
      desc: 'Campanhas com variáveis, spintax, cadência anti-bloqueio, quarentena de 30 dias e rastreamento de abertura.',
    },
    {
      icon: CreditCard,
      title: '5. Checkout & Domínio Próprio',
      desc: 'Cobrança única ou recorrente via webhook HMAC, remoção automática da marca d’água e SSL automático.',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">LocalSites AI</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white"
          >
            Entrar
          </Link>
          <Link
            href="/register"
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white"
          >
            Criar Workspace
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-16">
        <div className="max-w-3xl space-y-6">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-400/30 text-indigo-300 text-xs font-semibold">
            Plataforma SaaS Multi-Tenant · Prospecção Local & Venda Integrada
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight text-white">
            Descubra empresas sem site, gere prévias SPA com IA e venda no automático.
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed">
            Do mapeamento geográfico com deduplicação à publicação definitiva com domínio customizado e SSL após confirmação do checkout.
          </p>
          <div className="flex flex-wrap gap-4 pt-2">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-white"
            >
              Acessar Painel SaaS <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-slate-900 border border-slate-700 hover:border-slate-500 font-semibold text-slate-200"
            >
              Criar Nova Agência
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-16">
          {steps.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.title}
                className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-3"
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <h2 className="font-bold text-sm text-white">{s.title}</h2>
                <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

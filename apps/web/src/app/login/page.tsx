'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Lock, Mail, Sparkles } from 'lucide-react';
import { apiFetch, setStoredToken } from '@/lib/api-client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('operador@alfa.com.br');
  const [password, setPassword] = useState('Operador@123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: { role: string } }>('/api/auth/login', {
        method: 'POST',
        json: { email, password },
      });
      setStoredToken(res.token);
      if (res.user.role === 'GLOBAL_ADMIN') {
        router.push('/admin');
      } else {
        router.push('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Falha no login.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center mx-auto">
            <Sparkles className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Entrar no LocalSites AI</h1>
          <p className="text-xs text-slate-500">
            Acesse seu workspace multi-tenant ou o console administrativo global.
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
          <p className="font-semibold text-slate-600">Atalhos de demonstração:</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEmail('operador@alfa.com.br');
                setPassword('Operador@123');
              }}
              className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-indigo-400 font-medium"
            >
              Agência Alfa (Tenant A)
            </button>
            <button
              type="button"
              onClick={() => {
                setEmail('operador@beta.com.br');
                setPassword('Operador@123');
              }}
              className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-indigo-400 font-medium"
            >
              Agência Beta (Tenant B)
            </button>
            <button
              type="button"
              onClick={() => {
                setEmail('admin@plataforma.com.br');
                setPassword('Admin@123456');
              }}
              className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-indigo-400 font-medium"
            >
              Admin Global
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">E-mail</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Senha</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            data-testid="login-submit-btn"
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-sm transition"
          >
            {loading ? 'Autenticando...' : 'Entrar no Painel'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500">
          Ainda não tem workspace?{' '}
          <Link href="/register" className="text-indigo-600 font-semibold hover:underline">
            Criar agência grátis
          </Link>
        </p>
      </div>
    </div>
  );
}

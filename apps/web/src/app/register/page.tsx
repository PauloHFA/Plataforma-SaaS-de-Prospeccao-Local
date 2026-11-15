'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { apiFetch, setStoredToken } from '@/lib/api-client';

export default function RegisterPage() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string }>('/api/auth/register', {
        method: 'POST',
        json: { workspaceName, name, email, password },
      });
      setStoredToken(res.token);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Erro ao criar workspace.');
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
          <h1 className="text-2xl font-bold text-slate-900">Criar Workspace SaaS</h1>
          <p className="text-xs text-slate-500">
            Configure sua agência com isolamento multi-tenant completo.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nome da Agência / Workspace
            </label>
            <input
              required
              placeholder="Ex: Agência Impulso Digital"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Seu Nome</label>
            <input
              required
              placeholder="Ex: João Silva"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm"
          >
            {loading ? 'Criando...' : 'Criar Workspace e Entrar'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500">
          Já possui conta?{' '}
          <Link href="/login" className="text-indigo-600 font-semibold hover:underline">
            Fazer login
          </Link>
        </p>
      </div>
    </div>
  );
}

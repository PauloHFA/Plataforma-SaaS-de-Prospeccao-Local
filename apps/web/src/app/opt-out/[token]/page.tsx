'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, ShieldOff } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';

export default function OptOutPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<{ businessName: string; optedOut: boolean } | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    apiFetch<{ businessName: string; optedOut: boolean }>(`/api/public/opt-out/${token}`)
      .then((res) => {
        setInfo(res);
        setDone(res.optedOut);
      })
      .catch((err) => setError(err.message || 'Link inválido.'));
  }, [token]);

  const confirmOptOut = async () => {
    try {
      await apiFetch(`/api/public/opt-out/${token}`, { method: 'POST' });
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center mx-auto">
          {done ? <CheckCircle2 className="w-6 h-6 text-emerald-600" /> : <ShieldOff className="w-6 h-6" />}
        </div>
        <h1 className="text-xl font-bold text-slate-900">Preferências de Contato (LGPD)</h1>
        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : done ? (
          <p className="text-sm text-emerald-700">
            Descadastro confirmado para <strong>{info?.businessName}</strong>. Nenhum novo contato comercial será enviado por este workspace.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Confirme abaixo se <strong>{info?.businessName || 'sua empresa'}</strong> deseja não receber futuras mensagens comerciais.
            </p>
            <button
              type="button"
              onClick={confirmOptOut}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
            >
              Confirmar Descadastro Permanente
            </button>
          </>
        )}
      </div>
    </main>
  );
}

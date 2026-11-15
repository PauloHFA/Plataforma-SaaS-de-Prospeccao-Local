'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Bell,
  Compass,
  CreditCard,
  Globe,
  Kanban,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Plug,
  Settings,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';
import { apiFetch, setStoredToken } from '@/lib/api-client';

export interface CurrentUser {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: 'GLOBAL_ADMIN' | 'TENANT_OPERATOR' | 'END_CLIENT';
}

export interface WorkspaceUsage {
  tenant: {
    id: string;
    name: string;
    slug: string;
    creditsBalance: number;
    status: string;
  };
  plan: {
    name: string;
    monthlyCredits: number;
    maxSearchesPerMonth: number;
    maxSitesPerMonth: number;
    maxMessagesPerDay: number;
    maxActivePreviews: number;
    monthlyBudgetCents: number;
  };
  activePreviews: number;
  activeByokProviders: string[];
  monthly: {
    searches: number;
    siteGenerations: number;
    whatsappDispatches: number;
    emailDispatches: number;
    totalTokens: number;
    estimatedCostCents: number;
  };
  dailyDispatches: number;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export function ConsoleShell({
  children,
  title,
  subtitle,
  requireAdmin = false,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  requireAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceUsage | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadSession = async () => {
    try {
      const me = await apiFetch<{ user: CurrentUser; workspace: WorkspaceUsage | null }>('/api/auth/me');
      setUser(me.user);
      setWorkspace(me.workspace);
      if (requireAdmin && me.user.role !== 'GLOBAL_ADMIN') {
        router.replace('/dashboard');
        return;
      }
      if (me.user.tenantId) {
        const n = await apiFetch<{ notifications: NotificationItem[] }>('/api/notifications');
        setNotifications(n.notifications);
      }
    } catch {
      router.replace('/login');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSession();
    const timer = setInterval(() => {
      if (user?.tenantId) {
        apiFetch<{ notifications: NotificationItem[] }>('/api/notifications')
          .then((n) => setNotifications(n.notifications))
          .catch(() => {});
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [user?.tenantId]);

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setStoredToken(null);
    router.push('/login');
  };

  const markRead = async (id: string) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const navItems = [
    ...(user?.tenantId
      ? [
          { href: '/dashboard', label: 'Visão Geral', icon: LayoutDashboard },
          { href: '/leads', label: 'Captação de Leads', icon: Compass },
          { href: '/pipeline', label: 'Funil Kanban', icon: Kanban },
          { href: '/sites', label: 'Sites IA & Editor', icon: Globe },
          { href: '/campaigns', label: 'Disparos & Scripts', icon: MessageSquare },
          { href: '/connections', label: 'Conexões Envio', icon: Plug },
          { href: '/billing', label: 'Checkout & Domínios', icon: CreditCard },
          { href: '/settings', label: 'BYOK & Custos', icon: Settings },
        ]
      : []),
    ...(user?.role === 'GLOBAL_ADMIN'
      ? [{ href: '/admin', label: 'Administração Global', icon: Shield }]
      : []),
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm text-slate-500 font-medium">Carregando painel...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-slate-950 text-slate-200 border-r border-slate-800 shrink-0">
        <div className="h-16 px-5 flex items-center gap-2.5 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-none">LocalSites AI</p>
            <p className="text-[11px] text-slate-400 mt-1">Prospecção & Sites SaaS</p>
          </div>
        </div>

        {workspace && (
          <div className="mx-3 mt-4 p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-1.5">
            <p className="font-semibold text-white truncate">{workspace.tenant.name}</p>
            <div className="flex items-center justify-between text-slate-400">
              <span>Plano {workspace.plan.name}</span>
              <span className="text-emerald-400 font-bold tabular-nums">
                {workspace.tenant.creditsBalance} créditos
              </span>
            </div>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 text-xs space-y-3">
          <div className="truncate">
            <p className="font-semibold text-white truncate">{user?.name}</p>
            <p className="text-slate-400 truncate">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 font-medium"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sair
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-64 bg-slate-950 text-slate-200 h-full flex flex-col p-4 z-10">
            <div className="flex items-center justify-between mb-6">
              <span className="font-bold text-white">LocalSites AI</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="space-y-1 flex-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${
                      active ? 'bg-indigo-600 text-white' : 'text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 py-2 px-3 rounded-lg bg-slate-900 text-slate-300 text-xs"
            >
              <LogOut className="w-4 h-4" /> Sair
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-600"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">{title}</h1>
              {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
            </div>
          </div>

          <div className="relative flex items-center gap-3">
            {user?.tenantId && (
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                data-testid="notifications-bell"
                className="relative p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>
            )}

            {notifOpen && (
              <div className="absolute right-0 top-12 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 z-50 max-h-96 overflow-y-auto">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                  Notificações em Tempo Real
                </p>
                {notifications.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    Nenhuma notificação recente.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => !n.isRead && markRead(n.id)}
                        className={`p-3 rounded-xl border text-xs cursor-pointer transition ${
                          n.isRead
                            ? 'bg-slate-50 border-slate-100 text-slate-600'
                            : 'bg-indigo-50/70 border-indigo-200 text-slate-900'
                        }`}
                      >
                        <p className="font-bold">{n.title}</p>
                        <p className="mt-0.5 opacity-85">{n.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

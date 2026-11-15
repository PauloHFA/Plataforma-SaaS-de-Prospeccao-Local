import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LocalSites AI · Prospecção Local, Geração de Sites com IA e Checkout',
  description:
    'Plataforma SaaS Multi-Tenant para descoberta de empresas locais, geração automatizada de landing pages SPA com IA, mensageria integrada e checkout.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}

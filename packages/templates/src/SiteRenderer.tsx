'use client';

import React from 'react';
import {
  Briefcase,
  Building2,
  CalendarCheck,
  Car,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCheck2,
  Gauge,
  Heart,
  HeartPulse,
  MapPin,
  MessageCircle,
  Phone,
  PhoneCall,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Stethoscope,
  UtensilsCrossed,
  Wrench,
  Zap,
  ChevronDown,
} from 'lucide-react';
import type { FontPairing, SiteDocument, SiteStatus, TemplateSlug } from '@plataforma/shared';
import { TelemetryBeacon, trackSiteEvent } from './TelemetryBeacon.js';

export interface SiteRendererProps {
  document: SiteDocument;
  siteId?: string;
  status: SiteStatus;
  isEditorPreview?: boolean;
  apiBaseUrl?: string;
  checkoutUrl?: string;
  mediaBaseUrl?: string;
}

const FONT_STACK_MAP: Record<FontPairing, { heading: string; body: string }> = {
  'inter-plus-jakarta': {
    heading: '"Plus Jakarta Sans", "Inter", system-ui, -apple-system, sans-serif',
    body: '"Inter", system-ui, -apple-system, sans-serif',
  },
  'playfair-inter': {
    heading: '"Playfair Display", Georgia, Cambria, serif',
    body: '"Inter", system-ui, -apple-system, sans-serif',
  },
  'space-grotesk-inter': {
    heading: '"Space Grotesk", "Inter", system-ui, sans-serif',
    body: '"Inter", system-ui, -apple-system, sans-serif',
  },
  'poppins-dm-sans': {
    heading: '"Poppins", "DM Sans", system-ui, sans-serif',
    body: '"DM Sans", system-ui, sans-serif',
  },
  'merriweather-source': {
    heading: '"Merriweather", Georgia, serif',
    body: '"Source Sans 3", system-ui, sans-serif',
  },
};

function renderIcon(name: string, className = 'w-5 h-5') {
  const icons: Record<string, React.ReactNode> = {
    Stethoscope: <Stethoscope className={className} />,
    HeartPulse: <HeartPulse className={className} />,
    ShieldCheck: <ShieldCheck className={className} />,
    CalendarCheck: <CalendarCheck className={className} />,
    Wrench: <Wrench className={className} />,
    Gauge: <Gauge className={className} />,
    Car: <Car className={className} />,
    UtensilsCrossed: <UtensilsCrossed className={className} />,
    Sparkles: <Sparkles className={className} />,
    ShoppingBag: <ShoppingBag className={className} />,
    Briefcase: <Briefcase className={className} />,
    Building2: <Building2 className={className} />,
    FileCheck2: <FileCheck2 className={className} />,
    Heart: <Heart className={className} />,
    Star: <Star className={className} />,
    Zap: <Zap className={className} />,
    CheckCircle2: <CheckCircle2 className={className} />,
    PhoneCall: <PhoneCall className={className} />,
  };
  return icons[name] ?? <CheckCircle2 className={className} />;
}

function resolveImageSrc(url: string, mediaBaseUrl?: string): string {
  if (!url) return '/stock/servicos_locais/1.webp';
  if (url.startsWith('/api/media/') && mediaBaseUrl) {
    return `${mediaBaseUrl.replace(/\/$/, '')}${url}`;
  }
  return url;
}

function getLayoutVariant(slug: TemplateSlug) {
  switch (slug) {
    case 'automotive-bold':
      return { darkHero: true, rounded: 'rounded-lg', heroStyle: 'split' as const };
    case 'corporate-trust':
      return { darkHero: true, rounded: 'rounded-md', heroStyle: 'split' as const };
    case 'gastronomy-warm':
      return { darkHero: false, rounded: 'rounded-2xl', heroStyle: 'editorial' as const };
    case 'beauty-editorial':
      return { darkHero: false, rounded: 'rounded-3xl', heroStyle: 'editorial' as const };
    case 'clinical-clean':
      return { darkHero: false, rounded: 'rounded-2xl', heroStyle: 'split' as const };
    case 'local-express':
    default:
      return { darkHero: false, rounded: 'rounded-xl', heroStyle: 'split' as const };
  }
}

export function SiteRenderer({
  document: doc,
  siteId = '',
  status,
  isEditorPreview = false,
  apiBaseUrl = '',
  checkoutUrl,
  mediaBaseUrl,
}: SiteRendererProps) {
  if (status === 'SUSPENDED') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-16 text-slate-800">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold mb-2">Site Temporariamente Suspenso</h1>
          <p className="text-sm text-slate-600 mb-6">
            A página de <strong>{doc.business.name}</strong> encontra-se temporariamente indisponível por pendência administrativa. Todos os dados estão preservados para reativação imediata.
          </p>
          <p className="text-xs text-slate-500">
            Atendimento comercial: {doc.business.phoneDisplay}
          </p>
        </div>
      </main>
    );
  }

  if (status === 'ARCHIVED') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-16 text-slate-800">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold mb-2">Prévia Expirada</h1>
          <p className="text-sm text-slate-600">
            Esta demonstração temporária expirou após o período de avaliação. Solicite ao consultor responsável uma nova geração.
          </p>
        </div>
      </main>
    );
  }

  const fonts = FONT_STACK_MAP[doc.theme.fontPairing] ?? FONT_STACK_MAP['inter-plus-jakarta'];
  const variant = getLayoutVariant(doc.templateSlug);
  const waDigits = (doc.business.whatsappNumber || doc.business.phoneE164 || '').replace(/\D/g, '');
  const whatsappHref = waDigits
    ? `https://wa.me/${waDigits}?text=${encodeURIComponent(
        `Olá! Vi o site de ${doc.business.name} e gostaria de mais informações.`,
      )}`
    : `tel:${doc.business.phoneE164 || doc.business.phoneDisplay}`;

  const heroImg = resolveImageSrc(doc.hero.heroImageUrl, mediaBaseUrl);

  const cssVars = {
    '--site-primary': doc.theme.primaryColor,
    '--site-secondary': doc.theme.secondaryColor,
    '--site-accent': doc.theme.accentColor,
    '--site-bg': doc.theme.backgroundColor,
    '--site-surface': doc.theme.surfaceColor,
    '--site-text': doc.theme.textColor,
    fontFamily: fonts.body,
    backgroundColor: doc.theme.backgroundColor,
    color: doc.theme.textColor,
  } as React.CSSProperties;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: doc.business.name,
    description: doc.seo.description,
    telephone: doc.business.phoneE164 || doc.business.phoneDisplay,
    address: {
      '@type': 'PostalAddress',
      streetAddress: doc.business.address,
      addressLocality: doc.business.city,
      addressRegion: doc.business.state,
      addressCountry: 'BR',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: doc.business.lat,
      longitude: doc.business.lng,
    },
    aggregateRating:
      doc.business.reviewCount > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: doc.business.rating,
            reviewCount: doc.business.reviewCount,
          }
        : undefined,
  };

  return (
    <div style={cssVars} className="min-h-screen w-full overflow-x-hidden antialiased">
      {!isEditorPreview && siteId ? (
        <TelemetryBeacon siteId={siteId} apiBaseUrl={apiBaseUrl} disabled={isEditorPreview} />
      ) : null}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* RN-06: Marca d'água discreta obrigatória em status PREVIEW */}
      {status === 'PREVIEW' && (
        <div
          data-testid="preview-watermark-banner"
          className="w-full bg-slate-900 text-white text-xs sm:text-sm py-2.5 px-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700"
        >
          <span className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span>
              <strong>Prévia Exclusiva</strong> desenvolvida para <strong>{doc.business.name}</strong> — Demonstração temporária
            </span>
          </span>
          {checkoutUrl ? (
            <a
              href={checkoutUrl}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: doc.theme.primaryColor }}
            >
              Publicar Site Oficial
            </a>
          ) : (
            <span className="text-slate-300 text-xs">Ative o plano para remover este aviso</span>
          )}
        </div>
      )}

      {/* Header / Navbar */}
      <header
        className="sticky top-0 z-30 backdrop-blur-md border-b"
        style={{
          backgroundColor: variant.darkHero ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.92)',
          borderColor: variant.darkHero ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)',
          color: variant.darkHero ? '#ffffff' : doc.theme.textColor,
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold shrink-0"
              style={{ backgroundColor: doc.theme.primaryColor }}
            >
              {doc.business.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="truncate">
              <p className="font-bold text-sm sm:text-base truncate" style={{ fontFamily: fonts.heading }}>
                {doc.business.name}
              </p>
              <p className="text-xs opacity-75 truncate">
                {doc.business.categoryLabel} · {doc.business.neighborhood}
              </p>
            </div>
          </div>

          <nav className={isEditorPreview ? 'hidden' : 'hidden lg:flex items-center gap-6 text-sm font-medium opacity-90 shrink-0'}>
            <a href="#servicos" className="hover:opacity-100">
              Serviços
            </a>
            <a href="#sobre" className="hover:opacity-100">
              Sobre
            </a>
            <a href="#avaliacoes" className="hover:opacity-100">
              Avaliações
            </a>
            <a href="#localizacao" className="hover:opacity-100">
              Localização
            </a>
            <a href="#faq" className="hover:opacity-100">
              Dúvidas
            </a>
          </nav>

          <a
            href={whatsappHref}
            target={waDigits ? '_blank' : undefined}
            rel={waDigits ? 'noopener noreferrer' : undefined}
            onClick={() => !isEditorPreview && siteId && trackSiteEvent(siteId, 'CTA_CLICK', apiBaseUrl)}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold text-white shrink-0 transition hover:opacity-90 ${variant.rounded}`}
            style={{ backgroundColor: doc.theme.primaryColor }}
          >
            {doc.hero.ctaPrimary}
          </a>
        </div>
      </header>

      <main>
        {/* HERO SECTION */}
        <section
          className="relative py-12 sm:py-20"
          style={
            variant.darkHero
              ? { backgroundColor: '#0F172A', color: '#F8FAFC' }
              : { backgroundColor: doc.theme.backgroundColor }
          }
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className={variant.heroStyle === 'editorial' ? 'lg:col-span-6 space-y-6' : 'lg:col-span-7 space-y-6'}>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border"
                style={{
                  borderColor: doc.theme.primaryColor,
                  color: variant.darkHero ? '#ffffff' : doc.theme.primaryColor,
                  backgroundColor: variant.darkHero ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.04)',
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{doc.hero.badge}</span>
                {doc.business.rating > 0 && (
                  <span className="ml-1 inline-flex items-center gap-1 font-bold">
                    · ★ {doc.business.rating.toFixed(1)} ({doc.business.reviewCount})
                  </span>
                )}
              </div>

              <h1
                data-testid="site-hero-headline"
                className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.12]"
                style={{ fontFamily: fonts.heading }}
              >
                {doc.hero.headline}
              </h1>

              <p className="text-base sm:text-lg opacity-85 leading-relaxed max-w-2xl">
                {doc.hero.subheadline}
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href={whatsappHref}
                  target={waDigits ? '_blank' : undefined}
                  rel={waDigits ? 'noopener noreferrer' : undefined}
                  onClick={() => !isEditorPreview && siteId && trackSiteEvent(siteId, 'CTA_CLICK', apiBaseUrl)}
                  className={`inline-flex items-center gap-2 px-6 py-3.5 text-sm sm:text-base font-semibold text-white shadow-sm transition hover:opacity-95 ${variant.rounded}`}
                  style={{ backgroundColor: doc.theme.primaryColor }}
                >
                  <MessageCircle className="w-5 h-5" />
                  {doc.hero.ctaPrimary}
                </a>
                <a
                  href="#servicos"
                  className={`inline-flex items-center gap-2 px-6 py-3.5 text-sm sm:text-base font-semibold border transition ${variant.rounded}`}
                  style={{
                    borderColor: variant.darkHero ? 'rgba(255,255,255,0.28)' : 'rgba(15,23,42,0.18)',
                    color: variant.darkHero ? '#ffffff' : doc.theme.textColor,
                  }}
                >
                  {doc.hero.ctaSecondary}
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-3 text-xs sm:text-sm opacity-80">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 shrink-0" style={{ color: doc.theme.accentColor }} />
                  {doc.business.neighborhood}, {doc.business.city} - {doc.business.state}
                </span>
                <a
                  href={`tel:${doc.business.phoneE164 || doc.business.phoneDisplay}`}
                  onClick={() => !isEditorPreview && siteId && trackSiteEvent(siteId, 'PHONE_CLICK', apiBaseUrl)}
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  <Phone className="w-4 h-4 shrink-0" style={{ color: doc.theme.accentColor }} />
                  {doc.business.phoneDisplay}
                </a>
              </div>
            </div>

            <div className={variant.heroStyle === 'editorial' ? 'lg:col-span-6' : 'lg:col-span-5'}>
              <div className={`relative overflow-hidden shadow-xl border border-black/10 aspect-[3/2] ${variant.rounded}`}>
                <img
                  src={heroImg}
                  alt={doc.hero.heroImageAlt}
                  width={1280}
                  height={853}
                  loading="eager"
                  fetchPriority="high"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        {/* DIFFERENTIALS BAR */}
        <section
          className="py-10 border-y"
          style={{
            backgroundColor: doc.theme.surfaceColor,
            borderColor: 'rgba(15,23,42,0.08)',
          }}
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <h2
              className="text-xl sm:text-2xl font-bold mb-6"
              style={{ fontFamily: fonts.heading }}
            >
              {doc.differentials.title}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {doc.differentials.items.map((item, idx) => (
                <div
                  key={idx}
                  className={`p-5 border border-slate-200/80 ${variant.rounded}`}
                  style={{ backgroundColor: doc.theme.backgroundColor }}
                >
                  {item.metric && (
                    <span
                      className="inline-block text-xs font-bold uppercase tracking-wider mb-2 px-2.5 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: doc.theme.primaryColor }}
                    >
                      {item.metric}
                    </span>
                  )}
                  <h3 className="font-bold text-base mb-1.5" style={{ fontFamily: fonts.heading }}>
                    {item.title}
                  </h3>
                  <p className="text-sm opacity-80 leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SERVICES */}
        <section id="servicos" className="py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="max-w-2xl mb-10">
              <h2
                className="text-2xl sm:text-3xl font-bold mb-3"
                style={{ fontFamily: fonts.heading }}
              >
                {doc.services.title}
              </h2>
              <p className="text-base opacity-80">{doc.services.subtitle}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {doc.services.items.map((service, idx) => (
                <article
                  key={idx}
                  className={`p-6 border border-slate-200 shadow-sm flex flex-col justify-between transition hover:shadow-md ${variant.rounded}`}
                  style={{ backgroundColor: doc.theme.surfaceColor }}
                >
                  <div>
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center text-white mb-4"
                      style={{ backgroundColor: doc.theme.primaryColor }}
                    >
                      {renderIcon(service.icon)}
                    </div>
                    <h3 className="font-bold text-lg mb-2" style={{ fontFamily: fonts.heading }}>
                      {service.title}
                    </h3>
                    <p className="text-sm opacity-80 leading-relaxed">{service.description}</p>
                  </div>
                  <div className="mt-5 pt-3 border-t border-slate-100">
                    <a
                      href={whatsappHref}
                      target={waDigits ? '_blank' : undefined}
                      rel={waDigits ? 'noopener noreferrer' : undefined}
                      className="text-xs font-semibold inline-flex items-center gap-1 hover:underline"
                      style={{ color: doc.theme.primaryColor }}
                    >
                      Solicitar informações →
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ABOUT & GALLERY */}
        <section
          id="sobre"
          className="py-16 border-y"
          style={{
            backgroundColor: doc.theme.surfaceColor,
            borderColor: 'rgba(15,23,42,0.08)',
          }}
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6 space-y-5">
              <h2 className="text-2xl sm:text-3xl font-bold" style={{ fontFamily: fonts.heading }}>
                {doc.about.title}
              </h2>
              <p className="text-base opacity-85 leading-relaxed">{doc.about.description}</p>
              <ul className="space-y-2.5 pt-2">
                {doc.about.highlights.map((hl, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-sm font-medium">
                    <CheckCircle2
                      className="w-5 h-5 shrink-0 mt-0.5"
                      style={{ color: doc.theme.primaryColor }}
                    />
                    <span>{hl}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:col-span-6 grid grid-cols-2 gap-4">
              {doc.gallery.slice(0, 4).map((img, idx) => (
                <div
                  key={idx}
                  className={`overflow-hidden border border-slate-200 aspect-[3/2] ${
                    idx === 0 && doc.gallery.length === 3 ? 'col-span-2' : ''
                  } ${variant.rounded}`}
                >
                  <img
                    src={resolveImageSrc(img.url, mediaBaseUrl)}
                    alt={img.alt}
                    width={1280}
                    height={853}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* TESTIMONIALS (RF-09) */}
        <section id="avaliacoes" className="py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-10">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold" style={{ fontFamily: fonts.heading }}>
                  {doc.testimonials.title}
                </h2>
                <p className="text-sm opacity-80 mt-1">
                  Média de <strong>{doc.business.rating.toFixed(1)}</strong> estrelas com base em{' '}
                  <strong>{doc.business.reviewCount}</strong> avaliações públicas
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold">
                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                <span>{doc.business.rating.toFixed(1)} / 5.0</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {doc.testimonials.items.map((review, idx) => (
                <blockquote
                  key={idx}
                  className={`p-6 border border-slate-200 shadow-sm flex flex-col justify-between ${variant.rounded}`}
                  style={{ backgroundColor: doc.theme.surfaceColor }}
                >
                  <div>
                    <div className="flex items-center gap-1 mb-3">
                      {Array.from({ length: Math.round(review.rating) }).map((_, si) => (
                        <Star key={si} className="w-4 h-4 fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                    <p className="text-sm opacity-90 leading-relaxed mb-4">“{review.text}”</p>
                  </div>
                  <footer className="text-xs opacity-70 border-t border-slate-100 pt-3 flex items-center justify-between">
                    <strong className="font-semibold opacity-100">{review.author}</strong>
                    <span>{review.relativeTime}</span>
                  </footer>
                </blockquote>
              ))}
            </div>
          </div>
        </section>

        {/* LOCATION & OPENING HOURS (RF-09) */}
        <section
          id="localizacao"
          className="py-16 border-y"
          style={{
            backgroundColor: doc.theme.surfaceColor,
            borderColor: 'rgba(15,23,42,0.08)',
          }}
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-5 space-y-5">
              <h2 className="text-2xl sm:text-3xl font-bold" style={{ fontFamily: fonts.heading }}>
                {doc.location.title}
              </h2>
              <p className="text-sm opacity-85 leading-relaxed">{doc.location.instructions}</p>

              <div className="space-y-2 text-sm">
                <p className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 mt-1 shrink-0" style={{ color: doc.theme.primaryColor }} />
                  <span>{doc.business.address}</span>
                </p>
                <p className="flex items-center gap-2">
                  <Phone className="w-4 h-4 shrink-0" style={{ color: doc.theme.primaryColor }} />
                  <span>{doc.business.phoneDisplay}</span>
                </p>
              </div>

              <div className="pt-2">
                <h3 className="text-xs font-bold uppercase tracking-wider opacity-70 mb-2">
                  Horários de Atendimento
                </h3>
                <dl className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-xs sm:text-sm">
                  {doc.business.openingHours.map((oh, idx) => (
                    <div key={idx} className="flex items-center justify-between px-3.5 py-2 bg-white">
                      <dt className="font-medium text-slate-700">{oh.day}</dt>
                      <dd className="text-slate-600">{oh.hours}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <a
                href={doc.location.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 ${variant.rounded}`}
                style={{ backgroundColor: doc.theme.primaryColor }}
              >
                <ExternalLink className="w-4 h-4" />
                Abrir Rota no Google Maps
              </a>
            </div>

            <div className="lg:col-span-7">
              <div
                className={`h-full min-h-[320px] border border-slate-200 overflow-hidden flex flex-col justify-between bg-slate-100 ${variant.rounded}`}
              >
                <iframe
                  title={`Mapa de localização de ${doc.business.name}`}
                  loading="lazy"
                  className="w-full h-72 sm:h-full min-h-[320px] border-0"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${doc.business.lng - 0.01}%2C${doc.business.lat - 0.01}%2C${doc.business.lng + 0.01}%2C${doc.business.lat + 0.01}&layer=mapnik&marker=${doc.business.lat}%2C${doc.business.lng}`}
                />
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <h2
              className="text-2xl sm:text-3xl font-bold text-center mb-8"
              style={{ fontFamily: fonts.heading }}
            >
              {doc.faq.title}
            </h2>
            <div className="space-y-3">
              {doc.faq.items.map((item, idx) => (
                <details
                  key={idx}
                  className={`group border border-slate-200 p-5 ${variant.rounded}`}
                  style={{ backgroundColor: doc.theme.surfaceColor }}
                >
                  <summary className="font-semibold text-sm sm:text-base cursor-pointer list-none flex items-center justify-between gap-4">
                    <span>{item.question}</span>
                    <ChevronDown className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180 opacity-60" />
                  </summary>
                  <p className="text-sm opacity-80 mt-3 leading-relaxed">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="bg-slate-900 text-slate-300 py-10 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs sm:text-sm">
          <div>
            <p className="font-bold text-white text-base mb-1" style={{ fontFamily: fonts.heading }}>
              {doc.business.name}
            </p>
            <p className="opacity-80">{doc.footer.legalNotice}</p>
          </div>
          <p className="opacity-70">{doc.footer.copyright}</p>
        </div>
      </footer>

      {/* FLOATING WHATSAPP BUTTON (RF-09 + CA-07) */}
      <a
        href={whatsappHref}
        target={waDigits ? '_blank' : undefined}
        rel={waDigits ? 'noopener noreferrer' : undefined}
        aria-label={`Conversar com ${doc.business.name} pelo WhatsApp`}
        data-testid="floating-whatsapp-btn"
        onClick={() => {
          if (!isEditorPreview && siteId) {
            trackSiteEvent(siteId, 'WHATSAPP_CLICK', apiBaseUrl);
          }
        }}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-3.5 shadow-lg font-semibold text-sm transition-transform hover:scale-105"
      >
        <MessageCircle className="w-5 h-5" />
        <span className="hidden sm:inline">Falar no WhatsApp</span>
      </a>
    </div>
  );
}

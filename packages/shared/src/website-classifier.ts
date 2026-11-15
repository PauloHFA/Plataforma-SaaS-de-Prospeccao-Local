import type { WebsiteCategory } from './constants.js';

const SOCIAL_AGGREGATOR_HOSTS: ReadonlyArray<{ host: string; label: string }> = [
  { host: 'instagram.com', label: 'Instagram' },
  { host: 'instagr.am', label: 'Instagram' },
  { host: 'facebook.com', label: 'Facebook' },
  { host: 'fb.com', label: 'Facebook' },
  { host: 'fb.me', label: 'Facebook' },
  { host: 'linktr.ee', label: 'Linktree' },
  { host: 'linktree.com', label: 'Linktree' },
  { host: 'wa.me', label: 'WhatsApp' },
  { host: 'whatsapp.com', label: 'WhatsApp' },
  { host: 'tiktok.com', label: 'TikTok' },
  { host: 'youtube.com', label: 'YouTube' },
  { host: 'youtu.be', label: 'YouTube' },
  { host: 'ifood.com.br', label: 'iFood' },
  { host: 'rappi.com.br', label: 'Rappi' },
  { host: 'anota.ai', label: 'Anota AI' },
  { host: 'goomer.app', label: 'Goomer' },
  { host: 'guiamais.com.br', label: 'GuiaMais' },
  { host: 'solutudo.com.br', label: 'Solutudo' },
  { host: 'telelistas.net', label: 'TeleListas' },
  { host: 'doctoralia.com.br', label: 'Doctoralia' },
  { host: 'yelp.com', label: 'Yelp' },
  { host: 'tripadvisor.com', label: 'TripAdvisor' },
  { host: 'tripadvisor.com.br', label: 'TripAdvisor' },
  { host: 'beacons.ai', label: 'Beacons' },
  { host: 'bio.link', label: 'Bio.link' },
  { host: 'carrd.co', label: 'Carrd' },
  { host: 'canva.site', label: 'Canva Site' },
  { host: 'sites.google.com', label: 'Google Sites' },
  { host: 'negocio.site', label: 'Google Meu Negócio' },
  { host: 'business.site', label: 'Google Meu Negócio' },
  { host: 'mercadolivre.com.br', label: 'Mercado Livre' },
  { host: 'olx.com.br', label: 'OLX' },
  { host: 'getninjas.com.br', label: 'GetNinjas' },
  { host: 'habitissimo.com.br', label: 'Habitissimo' },
  { host: 'sympla.com.br', label: 'Sympla' },
  { host: 'linkedin.com', label: 'LinkedIn' },
];

export interface WebsiteClassification {
  category: WebsiteCategory;
  normalizedUrl: string | null;
  hostname: string | null;
  platformLabel: string | null;
}

/**
 * RF-02 + RN-02: Classifica o link cadastrado em Sem Website, Apenas Rede Social/Agregador,
 * ou Domínio Próprio.
 */
export function classifyWebsite(url: string | null | undefined): WebsiteClassification {
  if (!url || !url.trim()) {
    return {
      category: 'NO_WEBSITE',
      normalizedUrl: null,
      hostname: null,
      platformLabel: null,
    };
  }

  const trimmed = url.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return {
      category: 'NO_WEBSITE',
      normalizedUrl: null,
      hostname: null,
      platformLabel: null,
    };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!hostname || !hostname.includes('.')) {
    return {
      category: 'NO_WEBSITE',
      normalizedUrl: null,
      hostname: null,
      platformLabel: null,
    };
  }

  for (const entry of SOCIAL_AGGREGATOR_HOSTS) {
    if (hostname === entry.host || hostname.endsWith(`.${entry.host}`)) {
      return {
        category: 'SOCIAL_ONLY',
        normalizedUrl: parsed.toString(),
        hostname,
        platformLabel: entry.label,
      };
    }
  }

  return {
    category: 'OWN_DOMAIN',
    normalizedUrl: parsed.toString(),
    hostname,
    platformLabel: 'Website Próprio',
  };
}

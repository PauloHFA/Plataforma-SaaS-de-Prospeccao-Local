export const ROLES = ['GLOBAL_ADMIN', 'TENANT_OPERATOR', 'END_CLIENT'] as const;
export type Role = (typeof ROLES)[number];

export const FUNNEL_STAGES = [
  'LEAD_CAPTADO',
  'SITE_GERADO',
  'MENSAGEM_ENVIADA',
  'PREVIEW_VISUALIZADO',
  'EM_NEGOCIACAO',
  'VENDIDO',
  'DESCARTADO',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  LEAD_CAPTADO: 'Lead Captado',
  SITE_GERADO: 'Site Gerado',
  MENSAGEM_ENVIADA: 'Mensagem Enviada',
  PREVIEW_VISUALIZADO: 'Preview Visualizado',
  EM_NEGOCIACAO: 'Em Negociação',
  VENDIDO: 'Vendido',
  DESCARTADO: 'Descartado',
};

export const WEBSITE_CATEGORIES = ['NO_WEBSITE', 'SOCIAL_ONLY', 'OWN_DOMAIN'] as const;
export type WebsiteCategory = (typeof WEBSITE_CATEGORIES)[number];

export const WEBSITE_CATEGORY_LABELS: Record<WebsiteCategory, string> = {
  NO_WEBSITE: 'Sem Website',
  SOCIAL_ONLY: 'Apenas Rede Social / Agregador',
  OWN_DOMAIN: 'Domínio Próprio',
};

export const NICHES = [
  'clinicas',
  'oficinas',
  'restaurantes',
  'escritorios',
  'estetica',
  'servicos_locais',
] as const;
export type Niche = (typeof NICHES)[number];

export const NICHE_LABELS: Record<Niche, string> = {
  clinicas: 'Clínicas e Saúde',
  oficinas: 'Oficinas e Automotivo',
  restaurantes: 'Restaurantes e Gastronomia',
  escritorios: 'Escritórios e Consultoria',
  estetica: 'Estética, Beleza e Bem-Estar',
  servicos_locais: 'Serviços Locais',
};

export const TEMPLATE_SLUGS = [
  'clinical-clean',
  'automotive-bold',
  'gastronomy-warm',
  'corporate-trust',
  'beauty-editorial',
  'local-express',
] as const;
export type TemplateSlug = (typeof TEMPLATE_SLUGS)[number];

export const FONT_PAIRINGS = [
  'inter-plus-jakarta',
  'playfair-inter',
  'space-grotesk-inter',
  'poppins-dm-sans',
  'merriweather-source',
] as const;
export type FontPairing = (typeof FONT_PAIRINGS)[number];

export const SITE_STATUSES = [
  'DRAFT',
  'PREVIEW',
  'PUBLISHED',
  'SUSPENDED',
  'ARCHIVED',
] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export const SECRET_PROVIDERS = [
  'google_places',
  'openai',
  'anthropic',
  'stripe',
  'asaas',
  'evolution_api',
  'meta_cloud',
  'smtp',
] as const;
export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

export const OPT_OUT_KEYWORDS = [
  'sair',
  'parar',
  'stop',
  'remover',
  'descadastrar',
  'descadastro',
  'nao tenho interesse',
  'não tenho interesse',
  'cancelar',
  'bloquear',
] as const;

export const DEFAULT_TEMPLATE_BY_NICHE: Record<Niche, TemplateSlug> = {
  clinicas: 'clinical-clean',
  oficinas: 'automotive-bold',
  restaurantes: 'gastronomy-warm',
  escritorios: 'corporate-trust',
  estetica: 'beauty-editorial',
  servicos_locais: 'local-express',
};

export const CURATED_STOCK_BY_NICHE: Record<Niche, string[]> = {
  clinicas: [
    '/stock/clinicas/1.webp',
    '/stock/clinicas/2.webp',
    '/stock/clinicas/3.webp',
  ],
  oficinas: [
    '/stock/oficinas/1.webp',
    '/stock/oficinas/2.webp',
    '/stock/oficinas/3.webp',
  ],
  restaurantes: [
    '/stock/restaurantes/1.webp',
    '/stock/restaurantes/2.webp',
    '/stock/restaurantes/3.webp',
  ],
  escritorios: [
    '/stock/escritorios/1.webp',
    '/stock/escritorios/2.webp',
    '/stock/escritorios/3.webp',
  ],
  estetica: [
    '/stock/estetica/1.webp',
    '/stock/estetica/2.webp',
    '/stock/estetica/3.webp',
  ],
  servicos_locais: [
    '/stock/servicos_locais/1.webp',
    '/stock/servicos_locais/2.webp',
    '/stock/servicos_locais/3.webp',
  ],
};

export function inferNicheFromCategory(categoryOrKeyword: string): Niche {
  const s = categoryOrKeyword.toLowerCase();
  if (/cl[ií]nica|odont|dent|m[eé]dic|fisioter|psic[oó]|sa[uú]de|vet|oftalmo|dermato/.test(s)) {
    return 'clinicas';
  }
  if (/oficina|mec[aâ]nic|auto|funilaria|pneu|motor|car|lavagem|est[eé]tica automotiva/.test(s)) {
    return 'oficinas';
  }
  if (/restaurante|pizz|hamburgu|caf[eé]|bistr|padaria|sushi|bar|gastronomia|lanchonete|a[cç]a[ií]/.test(s)) {
    return 'restaurantes';
  }
  if (/escrit[oó]rio|advog|advocacia|contab|consultor|arquitet|engenharia|imobili/.test(s)) {
    return 'escritorios';
  }
  if (/est[eé]tica|sal[aã]o|barbearia|manicure|spa|sobrancelha|beleza|cabelo|depila/.test(s)) {
    return 'estetica';
  }
  return 'servicos_locais';
}

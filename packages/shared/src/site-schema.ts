import { z } from 'zod';
import { FONT_PAIRINGS, NICHES, TEMPLATE_SLUGS } from './constants.js';
import { sanitizePlainText } from './sanitize.js';

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor deve estar no formato hexadecimal (#RRGGBB)');

const SafeMediaPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (val) =>
      val.startsWith('/stock/') ||
      val.startsWith('/api/media/') ||
      val.startsWith('/uploads/') ||
      /^https?:\/\//i.test(val),
    'URL de imagem inválida ou protocolo não permitido',
  );

export const SiteThemeSchema = z.object({
  primaryColor: HexColorSchema,
  secondaryColor: HexColorSchema,
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  surfaceColor: HexColorSchema,
  textColor: HexColorSchema,
  fontPairing: z.enum(FONT_PAIRINGS),
});

export const OpeningHourSchema = z.object({
  day: z.string().min(1).max(24),
  hours: z.string().min(1).max(48),
});

export const ServiceItemSchema = z.object({
  title: z.string().min(2).max(55),
  description: z.string().min(5).max(180),
  icon: z.string().min(1).max(32),
});

export const DifferentialItemSchema = z.object({
  title: z.string().min(2).max(50),
  description: z.string().min(5).max(150),
  metric: z.string().max(25).optional(),
});

export const TestimonialItemSchema = z.object({
  author: z.string().min(2).max(60),
  rating: z.number().min(1).max(5),
  text: z.string().min(5).max(320),
  relativeTime: z.string().min(1).max(40),
});

export const GalleryItemSchema = z.object({
  url: SafeMediaPathSchema,
  alt: z.string().min(2).max(120),
  isStockFallback: z.boolean(),
});

export const FaqItemSchema = z.object({
  question: z.string().min(5).max(120),
  answer: z.string().min(10).max(360),
});

/**
 * RN-04 (Contrato JSON Estrito) + Premissa Arquitetural Central (Schema-Driven UI)
 */
export const SiteDocumentSchema = z.object({
  version: z.literal('1.0'),
  templateSlug: z.enum(TEMPLATE_SLUGS),
  niche: z.enum(NICHES),
  theme: SiteThemeSchema,
  business: z.object({
    name: z.string().min(2).max(80),
    categoryLabel: z.string().min(2).max(50),
    phoneE164: z.string().max(24),
    phoneDisplay: z.string().min(6).max(30),
    whatsappNumber: z.string().max(24).optional(),
    email: z.string().email().optional().or(z.literal('')),
    address: z.string().min(4).max(180),
    neighborhood: z.string().max(80),
    city: z.string().min(2).max(80),
    state: z.string().max(10),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    rating: z.number().min(0).max(5),
    reviewCount: z.number().int().min(0),
    openingHours: z.array(OpeningHourSchema).max(7),
  }),
  hero: z.object({
    badge: z.string().min(2).max(45),
    headline: z.string().min(8).max(90),
    subheadline: z.string().min(15).max(220),
    ctaPrimary: z.string().min(2).max(35),
    ctaSecondary: z.string().min(2).max(35),
    heroImageUrl: SafeMediaPathSchema,
    heroImageAlt: z.string().min(3).max(120),
  }),
  about: z.object({
    title: z.string().min(4).max(70),
    description: z.string().min(20).max(650),
    highlights: z.array(z.string().min(3).max(80)).min(2).max(4),
  }),
  services: z.object({
    title: z.string().min(4).max(70),
    subtitle: z.string().min(8).max(160),
    items: z.array(ServiceItemSchema).min(3).max(6),
  }),
  differentials: z.object({
    title: z.string().min(4).max(70),
    items: z.array(DifferentialItemSchema).min(3).max(4),
  }),
  testimonials: z.object({
    title: z.string().min(4).max(70),
    items: z.array(TestimonialItemSchema).min(1).max(6),
  }),
  gallery: z.array(GalleryItemSchema).min(1).max(6),
  location: z.object({
    title: z.string().min(4).max(70),
    instructions: z.string().min(5).max(180),
    mapsUrl: z.string().url().max(500),
  }),
  faq: z.object({
    title: z.string().min(4).max(70),
    items: z.array(FaqItemSchema).min(3).max(6),
  }),
  seo: z.object({
    title: z.string().min(8).max(70),
    description: z.string().min(20).max(160),
    keywords: z.array(z.string().min(2).max(40)).max(10),
  }),
  footer: z.object({
    copyright: z.string().min(4).max(100),
    legalNotice: z.string().min(4).max(140),
  }),
});

export type SiteDocument = z.infer<typeof SiteDocumentSchema>;

function sanitizeDeep<T>(val: T): T {
  if (typeof val === 'string') {
    return sanitizePlainText(val) as unknown as T;
  }
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeDeep(item)) as unknown as T;
  }
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = sanitizeDeep(v);
    }
    return out as T;
  }
  return val;
}

export function sanitizeAndValidateSiteDocument(input: unknown): SiteDocument {
  const sanitized = sanitizeDeep(input);
  return SiteDocumentSchema.parse(sanitized);
}

export function clampString(value: string, maxLen: number): string {
  const clean = sanitizePlainText(value);
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

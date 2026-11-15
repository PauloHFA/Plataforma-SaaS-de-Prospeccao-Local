import {
  classifyWebsite,
  inferNicheFromCategory,
  normalizeBrazilianPhone,
  normalizeTextKey,
  resolveApproximateCoordinates,
  type Niche,
  type WebsiteCategory,
} from '@plataforma/shared';
import { sha256Hex } from '@plataforma/shared/crypto';

export interface RawPlacePhoto {
  url: string;
  width: number;
  height: number;
}

export interface RawPlaceReview {
  author: string;
  rating: number;
  text: string;
  relativeTime: string;
}

export interface RawPlaceResult {
  placeId: string;
  businessName: string;
  category: string;
  niche: Niche;
  phoneRaw: string | null;
  phoneE164: string | null;
  phoneType: 'MOBILE' | 'LANDLINE' | 'UNKNOWN';
  websiteUrl: string | null;
  websiteCategory: WebsiteCategory;
  websitePlatformLabel: string | null;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string | null;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  reviews: RawPlaceReview[];
  openingHours: Array<{ day: string; hours: string }>;
  photos: RawPlacePhoto[];
}

export interface PlacesSearchParams {
  keyword: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  postalCode?: string;
  lat?: number;
  lng?: number;
  radiusKm: number;
  limit?: number;
  googlePlacesApiKey?: string;
}

const DEFAULT_HOURS = [
  { day: 'Segunda-feira', hours: '08:00 - 18:00' },
  { day: 'Terça-feira', hours: '08:00 - 18:00' },
  { day: 'Quarta-feira', hours: '08:00 - 18:00' },
  { day: 'Quinta-feira', hours: '08:00 - 18:00' },
  { day: 'Sexta-feira', hours: '08:00 - 18:00' },
  { day: 'Sábado', hours: '08:30 - 13:00' },
];

const NICHE_CATALOG_TEMPLATES: Record<
  Niche,
  {
    prefixes: string[];
    suffixes: string[];
    categoryLabel: string;
    reviews: string[];
  }
> = {
  clinicas: {
    prefixes: ['Clínica', 'Instituto', 'Consultório', 'Centro Médico', 'Odonto'],
    suffixes: ['Vida', 'Sorriso', 'Bem-Estar', 'Saúde Integrada', 'Excelência', 'São Lucas'],
    categoryLabel: 'Clínica de Saúde',
    reviews: [
      'Atendimento pontual, equipe muito atenciosa e ambiente extremamente limpo e acolhedor.',
      'Agendei pelo WhatsApp e fui atendido no mesmo dia. Profissionais excelentes!',
      'Explica cada detalhe do tratamento com clareza e transparência. Recomendo demais.',
    ],
  },
  oficinas: {
    prefixes: ['Auto Center', 'Oficina Mecânica', 'Garage', 'Centro Automotivo', 'Mecânica'],
    suffixes: ['Precision', 'Torque', 'Brasil', 'Express', 'Tech', 'Motores'],
    categoryLabel: 'Oficina Mecânica',
    reviews: [
      'Diagnóstico honesto sem empurrar peças desnecessárias. Meu carro ficou perfeito.',
      'Entrega no prazo combinado e orçamento justo enviado antes de executar o serviço.',
      'Melhor oficina da região, atendimento rápido e peças com garantia.',
    ],
  },
  restaurantes: {
    prefixes: ['Bistrô', 'Cantina', 'Casa', 'Restaurante', 'Sabores'],
    suffixes: ['da Praça', 'Nobre', 'Artesanal', 'Gourmet', 'Tradicional', 'do Chef'],
    categoryLabel: 'Restaurante',
    reviews: [
      'Comida deliciosa, pratos muito bem servidos e atendimento impecável.',
      'Ambiente aconchegante para ir com a família. Preço justo pela qualidade.',
      'Entrega rápida e tudo chegou quentinho. Já virou nosso restaurante favorito do bairro!',
    ],
  },
  escritorios: {
    prefixes: ['Escritório', 'Consultoria', 'Assessoria', 'Grupo', 'Núcleo'],
    suffixes: ['Almeida & Associados', 'Estratégia', 'Contábil', 'Soluções', 'Vanguarda'],
    categoryLabel: 'Escritório e Consultoria',
    reviews: [
      'Atendimento ágil e consultoria clara que resolveu nossa demanda com segurança.',
      'Equipe altamente capacitada, sempre disponível para tirar dúvidas.',
      'Transparência nos prazos e acompanhamento completo do início ao fim.',
    ],
  },
  estetica: {
    prefixes: ['Studio', 'Espaço', 'Atelier', 'Clínica de Estética', 'Salão'],
    suffixes: ['Lumière', 'Belle', 'Essência', 'Glow', 'Harmonia', 'Visage'],
    categoryLabel: 'Estética e Beleza',
    reviews: [
      'Resultado incrível já na primeira sessão, produtos de primeira linha.',
      'Ambiente lindo, super relaxante e profissionais muito cuidadosas.',
      'Fácil de agendar horário e atendimento super personalizado!',
    ],
  },
  servicos_locais: {
    prefixes: ['Soluções', 'Serviços', 'Central', 'Pro', 'Atendimento'],
    suffixes: ['Rápida', 'Confiança', 'Total', 'Especializada', 'Prime', '24h'],
    categoryLabel: 'Serviços Locais',
    reviews: [
      'Chegaram no horário exato e resolveram o problema com muita agilidade.',
      'Orçamento transparente pelo WhatsApp e trabalho limpo e bem acabado.',
      'Excelente custo-benefício, com certeza contratarei novamente.',
    ],
  },
};

const STREET_NAMES = [
  'Av. Paulista',
  'Rua Augusta',
  'Rua Oscar Freire',
  'Av. Brasil',
  'Rua das Flores',
  'Av. Getúlio Vargas',
  'Rua Sete de Setembro',
  'Av. Afonso Pena',
  'Rua XV de Novembro',
  'Av. Independência',
];

const NEIGHBORHOODS = [
  'Centro',
  'Jardins',
  'Vila Mariana',
  'Pinheiros',
  'Moema',
  'Savassi',
  'Batel',
  'Boa Viagem',
  'Moinhos de Vento',
  'Itaim Bibi',
];

const REVIEWER_NAMES = [
  'Mariana Costa',
  'Carlos Eduardo Silva',
  'Fernanda Oliveira',
  'Rafael Almeida',
  'Juliana Mendes',
  'Bruno Ferreira',
];

export async function searchLocalBusinesses(params: PlacesSearchParams): Promise<{
  provider: 'google_places' | 'sandbox';
  center: { lat: number; lng: number; city: string; state: string };
  results: RawPlaceResult[];
}> {
  const coords = resolveApproximateCoordinates({
    city: params.city,
    state: params.state,
    postalCode: params.postalCode,
    neighborhood: params.neighborhood,
    lat: params.lat,
    lng: params.lng,
  });

  const apiKey = (params.googlePlacesApiKey || process.env.GOOGLE_PLACES_API_KEY || '').trim();
  const forceSandbox = process.env.PLACES_PROVIDER === 'sandbox';

  if (apiKey && !forceSandbox) {
    try {
      const realResults = await fetchFromGooglePlaces({
        apiKey,
        keyword: params.keyword,
        city: coords.city || params.city || 'São Paulo',
        state: coords.state || params.state || 'SP',
        neighborhood: params.neighborhood,
        lat: coords.lat,
        lng: coords.lng,
        radiusKm: params.radiusKm,
        limit: params.limit ?? 20,
      });
      return {
        provider: 'google_places',
        center: {
          lat: coords.lat,
          lng: coords.lng,
          city: coords.city || params.city || 'São Paulo',
          state: coords.state || params.state || 'SP',
        },
        results: realResults,
      };
    } catch (err) {
      console.warn('[PlacesProvider] Falha ao consultar Google Places API, usando fallback sandbox:', err);
    }
  }

  const sandboxResults = generateDeterministicSandboxPlaces({
    keyword: params.keyword,
    city: coords.city || params.city || 'São Paulo',
    state: coords.state || params.state || 'SP',
    neighborhood: params.neighborhood,
    postalCode: params.postalCode,
    lat: coords.lat,
    lng: coords.lng,
    radiusKm: params.radiusKm,
    limit: params.limit ?? 20,
  });

  return {
    provider: 'sandbox',
    center: {
      lat: coords.lat,
      lng: coords.lng,
      city: coords.city || params.city || 'São Paulo',
      state: coords.state || params.state || 'SP',
    },
    results: sandboxResults,
  };
}

async function fetchFromGooglePlaces(input: {
  apiKey: string;
  keyword: string;
  city: string;
  state: string;
  neighborhood?: string;
  lat: number;
  lng: number;
  radiusKm: number;
  limit: number;
}): Promise<RawPlaceResult[]> {
  const textQuery = [input.keyword, input.neighborhood, input.city, input.state, 'Brasil']
    .filter(Boolean)
    .join(' ');

  const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': input.apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.regularOpeningHours,places.reviews,places.photos,places.primaryTypeDisplayName',
    },
    body: JSON.stringify({
      textQuery,
      languageCode: 'pt-BR',
      maxResultCount: Math.min(20, input.limit),
      locationBias: {
        circle: {
          center: { latitude: input.lat, longitude: input.lng },
          radius: Math.min(50000, Math.max(500, input.radiusKm * 1000)),
        },
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Google Places API status ${resp.status}`);
  }

  const data = (await resp.json()) as { places?: Array<Record<string, any>> };
  const niche = inferNicheFromCategory(input.keyword);

  return (data.places || []).map((place) => {
    const rawPhone = place.internationalPhoneNumber || place.nationalPhoneNumber || '';
    const normPhone = normalizeBrazilianPhone(rawPhone);
    const webClass = classifyWebsite(place.websiteUri);
    const reviews: RawPlaceReview[] = Array.isArray(place.reviews)
      ? place.reviews.slice(0, 5).map((r: any) => ({
          author: r.authorAttribution?.displayName || 'Cliente Verificado',
          rating: Number(r.rating || 5),
          text: String(r.text?.text || r.originalText?.text || 'Ótimo atendimento!'),
          relativeTime: String(r.relativePublishTimeDescription || 'recentemente'),
        }))
      : [];

    const photos: RawPlacePhoto[] = Array.isArray(place.photos)
      ? place.photos.slice(0, 4).map((p: any) => ({
          url: `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=1200&key=${input.apiKey}`,
          width: Number(p.widthPx || 1200),
          height: Number(p.heightPx || 800),
        }))
      : [];

    const weekdayDescriptions: string[] = place.regularOpeningHours?.weekdayDescriptions || [];
    const openingHours =
      weekdayDescriptions.length > 0
        ? weekdayDescriptions.slice(0, 7).map((line) => {
            const [day, ...rest] = line.split(':');
            return { day: (day || 'Dia').trim(), hours: rest.join(':').trim() || '08:00 - 18:00' };
          })
        : DEFAULT_HOURS;

    return {
      placeId: String(place.id),
      businessName: String(place.displayName?.text || 'Estabelecimento Local'),
      category: String(place.primaryTypeDisplayName?.text || input.keyword),
      niche,
      phoneRaw: rawPhone || null,
      phoneE164: normPhone.e164,
      phoneType: normPhone.type,
      websiteUrl: webClass.normalizedUrl,
      websiteCategory: webClass.category,
      websitePlatformLabel: webClass.platformLabel,
      address: String(place.formattedAddress || `${input.city}, ${input.state}`),
      neighborhood: input.neighborhood || 'Centro',
      city: input.city,
      state: input.state,
      postalCode: null,
      lat: Number(place.location?.latitude ?? input.lat),
      lng: Number(place.location?.longitude ?? input.lng),
      rating: Number(place.rating ?? 4.7),
      reviewCount: Number(place.userRatingCount ?? 42),
      reviews,
      openingHours,
      photos,
    };
  });
}

function generateDeterministicSandboxPlaces(input: {
  keyword: string;
  city: string;
  state: string;
  neighborhood?: string;
  postalCode?: string;
  lat: number;
  lng: number;
  radiusKm: number;
  limit: number;
}): RawPlaceResult[] {
  const niche = inferNicheFromCategory(input.keyword);
  const template = NICHE_CATALOG_TEMPLATES[niche];
  const seedKey = `${normalizeTextKey(input.city)}:${normalizeTextKey(input.keyword)}`;
  const seedHash = sha256Hex(seedKey);

  const count = Math.min(20, Math.max(6, input.limit));
  const results: RawPlaceResult[] = [];

  for (let i = 0; i < count; i++) {
    const itemHash = sha256Hex(`${seedHash}:${i}`);
    const n1 = parseInt(itemHash.slice(0, 4), 16);
    const n2 = parseInt(itemHash.slice(4, 8), 16);
    const n3 = parseInt(itemHash.slice(8, 12), 16);

    const prefix = template.prefixes[i % template.prefixes.length]!;
    const suffix = template.suffixes[(i + (n1 % 3)) % template.suffixes.length]!;
    const businessName =
      i >= template.prefixes.length ? `${prefix} ${suffix} ${i + 1}` : `${prefix} ${suffix}`;

    const slug = normalizeTextKey(businessName).replace(/\s+/g, '');
    const neighborhood =
      input.neighborhood || NEIGHBORHOODS[(i + (n2 % 5)) % NEIGHBORHOODS.length]!;
    const street = STREET_NAMES[(i + (n3 % 4)) % STREET_NAMES.length]!;
    const number = 100 + ((n1 + i * 37) % 1800);
    const address = `${street}, ${number} - ${neighborhood}, ${input.city} - ${input.state}`;

    // Deterministic spread within radiusKm
    const angle = ((n1 % 360) * Math.PI) / 180;
    const distKm = ((n2 % 90) / 100) * Math.max(0.5, input.radiusKm * 0.85);
    const dLat = (distKm / 111) * Math.cos(angle);
    const dLng = (distKm / (111 * Math.cos((input.lat * Math.PI) / 180))) * Math.sin(angle);

    // Deterministic website classification mix (CA-01: NO_WEBSITE, SOCIAL_ONLY, OWN_DOMAIN)
    let rawUrl: string | null = null;
    const webMod = i % 10;
    if (webMod === 1 || webMod === 4 || webMod === 7) {
      rawUrl =
        webMod === 1
          ? `https://instagram.com/${slug}`
          : webMod === 4
            ? `https://linktr.ee/${slug}`
            : `https://facebook.com/${slug}`;
    } else if (webMod === 3 || webMod === 8) {
      rawUrl = `https://www.${slug}.com.br`;
    }

    const webClass = classifyWebsite(rawUrl);

    // Deterministic mix of Mobile (with WhatsApp) and Landlines (CA-02 / RN-03)
    const ddd = input.state.toUpperCase() === 'RJ' ? '21' : input.state.toUpperCase() === 'MG' ? '31' : '11';
    const isLandline = i % 3 === 2; // 1/3 landlines, 2/3 mobile
    const phoneDigits = String(10000000 + ((n1 * 31 + i * 7919) % 89999999)).slice(0, 8);
    const rawPhone = isLandline
      ? `(${ddd}) 3${phoneDigits.slice(1, 4)}-${phoneDigits.slice(4, 8)}`
      : `(${ddd}) 9${phoneDigits}`;
    const normPhone = normalizeBrazilianPhone(rawPhone);

    // Mix of photos: some with 0 photos (for CA-05 / RN-05 fallback), some low-res (<800px), some high-res
    const photos: RawPlacePhoto[] =
      i % 4 === 0
        ? [] // Sem fotos -> RN-05 / CA-05 stock fallback
        : i % 4 === 1
          ? [{ url: `https://example.invalid/lowres-${i}.jpg`, width: 480, height: 320 }] // < 800px -> fallback
          : [
              {
                url: `/stock/${niche}/${(i % 3) + 1}.webp`,
                width: 1280,
                height: 853,
              },
            ];

    const rating = Number((4.3 + ((n1 % 7) * 0.1)).toFixed(1));
    const reviewCount = 18 + (n2 % 240);

    const reviews: RawPlaceReview[] = [0, 1, 2].map((ri) => ({
      author: REVIEWER_NAMES[(i + ri) % REVIEWER_NAMES.length]!,
      rating: ri === 2 ? 4 : 5,
      text: template.reviews[(i + ri) % template.reviews.length]!,
      relativeTime: ri === 0 ? 'há 2 semanas' : ri === 1 ? 'há 1 mês' : 'há 3 meses',
    }));

    results.push({
      placeId: `place_${seedHash.slice(0, 10)}_${i}`,
      businessName,
      category: input.keyword.trim() || template.categoryLabel,
      niche,
      phoneRaw: rawPhone,
      phoneE164: normPhone.e164,
      phoneType: normPhone.type,
      websiteUrl: webClass.normalizedUrl,
      websiteCategory: webClass.category,
      websitePlatformLabel: webClass.platformLabel,
      address,
      neighborhood,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode || `${ddd}010-000`,
      lat: Number((input.lat + dLat).toFixed(6)),
      lng: Number((input.lng + dLng).toFixed(6)),
      rating,
      reviewCount,
      reviews,
      openingHours: DEFAULT_HOURS,
      photos,
    });
  }

  return results;
}

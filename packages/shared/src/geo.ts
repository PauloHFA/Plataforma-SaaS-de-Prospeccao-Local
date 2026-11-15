import { fnvHashHex } from './sanitize.js';

export interface GeoPoint {
  lat: number;
  lng: number;
  city?: string;
  state?: string;
  neighborhood?: string;
}

const CITY_CENTERS: Record<string, GeoPoint> = {
  'sao paulo': { lat: -23.5505, lng: -46.6333, city: 'São Paulo', state: 'SP' },
  'rio de janeiro': { lat: -22.9068, lng: -43.1729, city: 'Rio de Janeiro', state: 'RJ' },
  'belo horizonte': { lat: -19.9167, lng: -43.9345, city: 'Belo Horizonte', state: 'MG' },
  'curitiba': { lat: -25.4284, lng: -49.2733, city: 'Curitiba', state: 'PR' },
  'porto alegre': { lat: -30.0346, lng: -51.2177, city: 'Porto Alegre', state: 'RS' },
  'brasilia': { lat: -15.7975, lng: -47.8919, city: 'Brasília', state: 'DF' },
  'salvador': { lat: -12.9714, lng: -38.5014, city: 'Salvador', state: 'BA' },
  'fortaleza': { lat: -3.7319, lng: -38.5267, city: 'Fortaleza', state: 'CE' },
  'recife': { lat: -8.0476, lng: -34.877, city: 'Recife', state: 'PE' },
  'campinas': { lat: -22.9099, lng: -47.0626, city: 'Campinas', state: 'SP' },
  'florianopolis': { lat: -27.5954, lng: -48.548, city: 'Florianópolis', state: 'SC' },
  'goiania': { lat: -16.6869, lng: -49.2648, city: 'Goiânia', state: 'GO' },
  'manaus': { lat: -3.119, lng: -60.0217, city: 'Manaus', state: 'AM' },
  'ribeirao preto': { lat: -21.1704, lng: -47.8103, city: 'Ribeirão Preto', state: 'SP' },
  'sorocaba': { lat: -23.5015, lng: -47.4526, city: 'Sorocaba', state: 'SP' },
  'santos': { lat: -23.9608, lng: -46.3336, city: 'Santos', state: 'SP' },
  'uberlandia': { lat: -18.9186, lng: -48.2772, city: 'Uberlândia', state: 'MG' },
  'londrina': { lat: -23.3045, lng: -51.1696, city: 'Londrina', state: 'PR' },
  'joinville': { lat: -26.3045, lng: -48.8487, city: 'Joinville', state: 'SC' },
};

export function normalizeTextKey(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveApproximateCoordinates(params: {
  city?: string;
  state?: string;
  postalCode?: string;
  neighborhood?: string;
  lat?: number;
  lng?: number;
}): GeoPoint {
  if (typeof params.lat === 'number' && typeof params.lng === 'number' && !Number.isNaN(params.lat) && !Number.isNaN(params.lng)) {
    return {
      lat: params.lat,
      lng: params.lng,
      city: params.city,
      state: params.state,
      neighborhood: params.neighborhood,
    };
  }

  const cityKey = normalizeTextKey(params.city || '');
  if (cityKey && CITY_CENTERS[cityKey]) {
    const base = CITY_CENTERS[cityKey];
    if (params.neighborhood) {
      // Slight deterministic offset per neighborhood inside city
      const h = parseInt(fnvHashHex(normalizeTextKey(params.neighborhood)).slice(0, 6), 16);
      const dLat = ((h % 100) - 50) * 0.0005;
      const dLng = (((h >> 8) % 100) - 50) * 0.0005;
      return {
        lat: Number((base.lat + dLat).toFixed(6)),
        lng: Number((base.lng + dLng).toFixed(6)),
        city: base.city,
        state: params.state || base.state,
        neighborhood: params.neighborhood,
      };
    }
    return { ...base, state: params.state || base.state };
  }

  // Deterministic Brazil coordinate from city/CEP string if not in dictionary
  const seed = fnvHashHex(`${cityKey}:${params.state || ''}:${params.postalCode || ''}`);
  const latOffset = (parseInt(seed.slice(0, 4), 16) % 1000) / 1000;
  const lngOffset = (parseInt(seed.slice(4, 8), 16) % 1000) / 1000;
  return {
    lat: Number((-23.5 + (latOffset - 0.5) * 4).toFixed(6)),
    lng: Number((-46.6 + (lngOffset - 0.5) * 4).toFixed(6)),
    city: params.city || 'São Paulo',
    state: params.state || 'SP',
    neighborhood: params.neighborhood,
  };
}

/**
 * RN-01: Indexa o cache geográfico compartilhado por célula de grade (~2km) e categoria.
 */
export function computeGeoGridKey(params: {
  lat: number;
  lng: number;
  radiusKm: number;
  keyword: string;
}): string {
  const latCell = Math.round(params.lat * 50) / 50; // ~2.2km grid
  const lngCell = Math.round(params.lng * 50) / 50;
  const bucketRadius = Math.max(1, Math.ceil(params.radiusKm / 2) * 2);
  const normKeyword = normalizeTextKey(params.keyword);
  return fnvHashHex(`${latCell.toFixed(2)}:${lngCell.toFixed(2)}:${bucketRadius}:${normKeyword}`);
}

export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function slugifyBusinessName(name: string, suffix?: string): string {
  const base = normalizeTextKey(name)
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  const safeBase = base || 'empresa-local';
  return suffix ? `${safeBase}-${suffix}` : safeBase;
}

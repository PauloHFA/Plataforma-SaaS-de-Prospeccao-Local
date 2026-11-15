import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CURATED_STOCK_BY_NICHE, type Niche } from '@plataforma/shared';
import { generateSecureToken } from '@plataforma/shared/crypto';

export interface ProcessedGalleryImage {
  url: string;
  width: number;
  height: number;
  isStockFallback: boolean;
}

const MIN_REQUIRED_WIDTH = 800;

/**
 * RN-05 + CA-05: Valida resolução >= 800px e disponibilidade da foto;
 * caso contrário seleciona automaticamente imagens temáticas licenciadas do acervo do nicho.
 */
export async function resolveSiteImages(params: {
  niche: Niche;
  businessName: string;
  rawPhotos: Array<{ url: string; width: number; height: number }>;
  apiBaseUrl?: string;
}): Promise<{ heroImageUrl: string; gallery: ProcessedGalleryImage[] }> {
  const stockPaths = CURATED_STOCK_BY_NICHE[params.niche];
  const validPhotos: ProcessedGalleryImage[] = [];

  for (const photo of params.rawPhotos) {
    if (!photo.url) continue;
    // Allow internal stock URLs directly if >= 800px
    if (photo.url.startsWith('/stock/') && photo.width >= MIN_REQUIRED_WIDTH) {
      validPhotos.push({
        url: photo.url,
        width: photo.width,
        height: photo.height,
        isStockFallback: false,
      });
      continue;
    }

    if (photo.width > 0 && photo.width < MIN_REQUIRED_WIDTH) {
      // RN-05: Rejeitar imagens abaixo de 800px de largura
      continue;
    }

    if (/^https?:\/\//i.test(photo.url)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const resp = await fetch(photo.url, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) continue;
        const buf = Buffer.from(await resp.arrayBuffer());
        const meta = await sharp(buf).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        if (w < MIN_REQUIRED_WIDTH) continue;

        const webpBuf = await sharp(buf)
          .resize({ width: 1280, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();

        const storedUrl = await storeMediaBuffer(webpBuf, `places/${generateSecureToken(8)}.webp`);
        validPhotos.push({
          url: storedUrl,
          width: Math.min(w, 1280),
          height: h,
          isStockFallback: false,
        });
      } catch {
        // Ignore broken remote image and fall back cleanly
      }
    }
  }

  // Fill up to 3 curated stock images if none passed >=800px check (RN-05 / CA-05)
  if (validPhotos.length === 0) {
    const fallbackGallery: ProcessedGalleryImage[] = stockPaths.map((stockUrl) => ({
      url: stockUrl,
      width: 1280,
      height: 853,
      isStockFallback: true,
    }));
    return {
      heroImageUrl: fallbackGallery[0]!.url,
      gallery: fallbackGallery,
    };
  }

  // Ensure at least 3 gallery items without duplicating broken images
  let idx = 0;
  while (validPhotos.length < 3 && idx < stockPaths.length) {
    const candidate = stockPaths[idx++]!;
    if (!validPhotos.some((p) => p.url === candidate)) {
      validPhotos.push({
        url: candidate,
        width: 1280,
        height: 853,
        isStockFallback: true,
      });
    }
  }

  return {
    heroImageUrl: validPhotos[0]!.url,
    gallery: validPhotos,
  };
}

export async function optimizeAndStoreUploadedImage(
  inputBuffer: Buffer,
  tenantId: string,
): Promise<{ url: string; width: number; height: number }> {
  const meta = await sharp(inputBuffer).metadata();
  const webpBuffer = await sharp(inputBuffer)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 84 })
    .toBuffer();
  const outMeta = await sharp(webpBuffer).metadata();
  const key = `tenants/${tenantId}/${generateSecureToken(10)}.webp`;
  const url = await storeMediaBuffer(webpBuffer, key);
  return {
    url,
    width: outMeta.width ?? meta.width ?? 1200,
    height: outMeta.height ?? meta.height ?? 800,
  };
}

async function storeMediaBuffer(buffer: Buffer, key: string): Promise<string> {
  const driver = process.env.STORAGE_DRIVER || 'local';
  const bucket = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;

  if (driver === 's3' && bucket) {
    const client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: endpoint || undefined,
      forcePathStyle: Boolean(endpoint),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
    });
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    const publicBase = (process.env.S3_PUBLIC_URL || `${endpoint}/${bucket}`).replace(/\/$/, '');
    return `${publicBase}/${key}`;
  }

  const baseDir = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || './data/uploads');
  const targetPath = path.join(baseDir, key);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer);
  return `/api/media/${key}`;
}

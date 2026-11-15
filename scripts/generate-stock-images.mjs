import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.resolve(process.cwd(), 'packages/integrations/package.json'));
const sharp = require('sharp');

const NICHES = [
  {
    slug: 'clinicas',
    title: 'Ambiente Clínico Moderno',
    palettes: [
      ['#0f766e', '#14b8a6', '#ccfbf1'],
      ['#0369a1', '#38bdf8', '#e0f2fe'],
      ['#115e59', '#2dd4bf', '#f0fdfa'],
    ],
  },
  {
    slug: 'oficinas',
    title: 'Centro Automotivo Técnico',
    palettes: [
      ['#0f172a', '#d97706', '#fef3c7'],
      ['#1e293b', '#f59e0b', '#fde68a'],
      ['#18181b', '#ea580c', '#fed7aa'],
    ],
  },
  {
    slug: 'restaurantes',
    title: 'Gastronomia Artesanal',
    palettes: [
      ['#7f1d1d', '#dc2626', '#fee2e2'],
      ['#78350f', '#d97706', '#fef3c7'],
      ['#450a0a', '#ea580c', '#ffedd5'],
    ],
  },
  {
    slug: 'escritorios',
    title: 'Consultoria Executiva',
    palettes: [
      ['#1e3a8a', '#3b82f6', '#dbeafe'],
      ['#0f172a', '#2563eb', '#eff6ff'],
      ['#1e293b', '#475569', '#f1f5f9'],
    ],
  },
  {
    slug: 'estetica',
    title: 'Estética &amp; Bem-Estar',
    palettes: [
      ['#831843', '#ec4899', '#fce7f3'],
      ['#701a75', '#d946ef', '#fae8ff'],
      ['#9d174d', '#f43f5e', '#ffe4e6'],
    ],
  },
  {
    slug: 'servicos_locais',
    title: 'Serviços Locais Especializados',
    palettes: [
      ['#1d4ed8', '#10b981', '#d1fae5'],
      ['#0f766e', '#2563eb', '#dbeafe'],
      ['#1e293b', '#059669', '#ecfdf5'],
    ],
  },
];

const outRoot = path.resolve(process.cwd(), 'apps/web/public/stock');

for (const niche of NICHES) {
  const dir = path.join(outRoot, niche.slug);
  await fs.mkdir(dir, { recursive: true });

  for (let i = 0; i < niche.palettes.length; i++) {
    const [c1, c2, c3] = niche.palettes[i];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="853" viewBox="0 0 1280 853">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${c1}"/>
          <stop offset="60%" stop-color="${c2}"/>
          <stop offset="100%" stop-color="${c1}"/>
        </linearGradient>
        <radialGradient id="glow" cx="72%" cy="32%" r="48%">
          <stop offset="0%" stop-color="${c3}" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="${c3}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1280" height="853" fill="url(#bg)"/>
      <rect width="1280" height="853" fill="url(#glow)"/>
      <circle cx="980" cy="240" r="240" fill="${c3}" fill-opacity="0.14"/>
      <circle cx="240" cy="680" r="300" fill="#ffffff" fill-opacity="0.08"/>
      <rect x="96" y="130" width="520" height="590" rx="36" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.22" stroke-width="2"/>
      <rect x="660" y="190" width="520" height="470" rx="36" fill="#0f172a" fill-opacity="0.24" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2"/>
      <rect x="148" y="210" width="220" height="24" rx="12" fill="${c3}" fill-opacity="0.65"/>
      <rect x="148" y="264" width="380" height="36" rx="10" fill="#ffffff" fill-opacity="0.75"/>
      <rect x="148" y="320" width="310" height="28" rx="10" fill="#ffffff" fill-opacity="0.45"/>
      <rect x="148" y="420" width="180" height="52" rx="14" fill="${c3}" fill-opacity="0.88"/>
      <rect x="720" y="260" width="400" height="190" rx="22" fill="#ffffff" fill-opacity="0.16"/>
      <rect x="720" y="485" width="190" height="110" rx="18" fill="${c3}" fill-opacity="0.28"/>
      <rect x="930" y="485" width="190" height="110" rx="18" fill="#ffffff" fill-opacity="0.18"/>
      <text x="148" y="650" font-family="sans-serif" font-size="28" font-weight="bold" fill="#ffffff" fill-opacity="0.82">${niche.title} · #${i + 1}</text>
    </svg>`;

    await sharp(Buffer.from(svg))
      .webp({ quality: 86 })
      .toFile(path.join(dir, `${i + 1}.webp`));
  }
}

console.log('18 imagens WebP curadas de alta resolução (1280x853) geradas em apps/web/public/stock.');

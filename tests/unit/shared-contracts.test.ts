import { describe, it, expect } from 'vitest';
import {
  classifyWebsite,
  clampString,
  computeGeoGridKey,
  normalizeBrazilianPhone,
  renderMessageTemplate,
  resolveApproximateCoordinates,
  sanitizeAndValidateSiteDocument,
  sanitizePlainText,
  slugifyBusinessName,
  type SiteDocument,
} from '@plataforma/shared';
import {
  decryptSecret,
  encryptSecret,
  generateSecureToken,
  hashPassword,
  signHmacSha256,
  verifyHmacSignature,
  verifyPassword,
} from '@plataforma/shared/crypto';
import {
  checkOperationalWindow,
  resolveSiteImages,
  validateWhatsAppNumber,
} from '@plataforma/integrations';

function createValidSiteDocFixture(): SiteDocument {
  return {
    version: '1.0',
    templateSlug: 'clinical-clean',
    niche: 'clinicas',
    theme: {
      primaryColor: '#0f766e',
      secondaryColor: '#0f172a',
      accentColor: '#14b8a6',
      backgroundColor: '#ffffff',
      surfaceColor: '#f8fafc',
      textColor: '#0f172a',
      fontPairing: 'inter-plus-jakarta',
    },
    business: {
      name: 'Clínica Odontológica Pinheiros',
      categoryLabel: 'Clínica Odontológica',
      phoneE164: '+5511987654321',
      phoneDisplay: '(11) 98765-4321',
      whatsappNumber: '+5511987654321',
      email: 'contato@clinicapinheiros.com.br',
      address: 'Rua dos Pinheiros, 450 - Pinheiros, São Paulo - SP',
      neighborhood: 'Pinheiros',
      city: 'São Paulo',
      state: 'SP',
      lat: -23.564,
      lng: -46.682,
      rating: 4.9,
      reviewCount: 128,
      openingHours: [{ day: 'Seg-Sex', hours: '08:00 - 18:00' }],
    },
    hero: {
      badge: 'Atendimento Humanizado em Pinheiros',
      headline: 'Sorriso saudável e tecnologia de ponta para toda a sua família',
      subheadline: 'Avaliação completa com especialistas experientes e agendamento rápido pelo WhatsApp.',
      ctaPrimary: 'Agendar pelo WhatsApp',
      ctaSecondary: 'Conhecer Serviços',
      heroImageUrl: '/stock/clinicas/1.webp',
      heroImageAlt: 'Recepção moderna da Clínica Odontológica Pinheiros',
    },
    about: {
      title: 'Excelência Clínica e Cuidado Individualizado',
      description:
        'Com infraestrutura moderna e protocolos rigorosos de biossegurança, oferecemos tratamentos odontológicos completos com conforto e transparência.',
      highlights: ['Equipamentos Digitais 3D', 'Corpo Clínico Especializado'],
    },
    services: {
      title: 'Especialidades e Tratamentos',
      subtitle: 'Soluções integradas para sua saúde bucal em um só lugar.',
      items: [
        { title: 'Implantodontia', description: 'Implantes de alta precisão com planejamento digital.', icon: 'ShieldCheck' },
        { title: 'Ortodontia Estética', description: 'Alinhadores transparentes e aparelhos discretos.', icon: 'Sparkles' },
        { title: 'Clínica Geral e Prevenção', description: 'Check-up completo, profilaxia e acompanhamento contínuo.', icon: 'HeartPulse' },
      ],
    },
    differentials: {
      title: 'Por que escolher nossa clínica',
      items: [
        { title: 'Agendamento Ágil', description: 'Confirmação direta pelo WhatsApp sem espera.', metric: '5 min' },
        { title: 'Nota 4.9 no Google', description: 'Mais de 120 avaliações reais de pacientes.', metric: '4.9 ★' },
        { title: 'Biossegurança Total', description: 'Esterilização certificada em cada atendimento.', metric: '100%' },
      ],
    },
    testimonials: {
      title: 'O que dizem nossos pacientes',
      items: [
        {
          author: 'Mariana Souza',
          rating: 5,
          text: 'Atendimento pontual e equipe muito atenciosa desde a recepção.',
          relativeTime: 'há 2 semanas',
        },
      ],
    },
    gallery: [{ url: '/stock/clinicas/2.webp', alt: 'Consultório moderno', isStockFallback: true }],
    location: {
      title: 'Localização Privilegiada em Pinheiros',
      instructions: 'Próximo ao metrô Fradique Coutinho, com estacionamento conveniado.',
      mapsUrl: 'https://www.google.com/maps?q=-23.564,-46.682',
    },
    faq: {
      title: 'Dúvidas Frequentes',
      items: [
        { question: 'Como agendar uma avaliação?', answer: 'Clique no botão de WhatsApp para escolher o melhor horário com nossa recepção.' },
        { question: 'Quais formas de pagamento aceitam?', answer: 'Aceitamos Pix, cartões de crédito parcelados e convênios selecionados.' },
        { question: 'Vocês atendem urgências?', answer: 'Sim, reservamos horários diários para atendimentos de dor aguda ou urgências.' },
      ],
    },
    seo: {
      title: 'Clínica Odontológica Pinheiros | Implantes e Ortodontia em SP',
      description: 'Clínica odontológica referência em Pinheiros, São Paulo. Agende sua avaliação rápida pelo WhatsApp.',
      keywords: ['dentista pinheiros', 'clinica odontologica sao paulo'],
    },
    footer: {
      copyright: '© 2026 Clínica Odontológica Pinheiros',
      legalNotice: 'Atendimento mediante agendamento prévio.',
    },
  };
}

describe('Regras de Negócio & Contratos (@plataforma/shared & @plataforma/integrations)', () => {
  it('RN-03 & RF-04: normaliza telefones brasileiros em E.164 e distingue móvel vs fixo vs 0800', async () => {
    const mobile1 = normalizeBrazilianPhone('(11) 98765-4321');
    expect(mobile1.isValid).toBe(true);
    expect(mobile1.e164).toBe('+5511987654321');
    expect(mobile1.type).toBe('MOBILE');
    expect(mobile1.canHaveWhatsApp).toBe(true);

    const mobile2 = normalizeBrazilianPhone('5521998877665');
    expect(mobile2.isValid).toBe(true);
    expect(mobile2.e164).toBe('+5521998877665');
    expect(mobile2.type).toBe('MOBILE');

    const landline = normalizeBrazilianPhone('(11) 3456-7890');
    expect(landline.isValid).toBe(true);
    expect(landline.e164).toBe('+551134567890');
    expect(landline.type).toBe('LANDLINE');
    expect(landline.canHaveWhatsApp).toBe(false);

    const tollFree = normalizeBrazilianPhone('0800 123 4567');
    expect(tollFree.isValid).toBe(true);
    expect(tollFree.type).toBe('LANDLINE');
    expect(tollFree.canHaveWhatsApp).toBe(false);

    const waMobile = await validateWhatsAppNumber({
      phoneE164: mobile1.e164,
      phoneType: mobile1.type,
    });
    expect(waMobile.hasWhatsApp).toBe(true);

    const waLandline = await validateWhatsAppNumber({
      phoneE164: landline.e164,
      phoneType: landline.type,
    });
    expect(waLandline.hasWhatsApp).toBe(false);
  });

  it('RF-02 & RN-02: classifica corretamente NO_WEBSITE, SOCIAL_ONLY e OWN_DOMAIN', () => {
    expect(classifyWebsite(null).category).toBe('NO_WEBSITE');
    expect(classifyWebsite('').category).toBe('NO_WEBSITE');

    const socialUrls = [
      'https://instagram.com/minhaclinica',
      'https://www.facebook.com/oficinacentral',
      'https://linktr.ee/restaurantesabor',
      'https://wa.me/5511999998888',
      'https://www.ifood.com.br/delivery/pizza-arte',
      'https://sites.google.com/view/advocacia',
      'https://www.doctoralia.com.br/medico/exemplo',
    ];
    for (const url of socialUrls) {
      expect(classifyWebsite(url).category).toBe('SOCIAL_ONLY');
    }

    const own = classifyWebsite('clinicapremium.com.br');
    expect(own.category).toBe('OWN_DOMAIN');
    expect(own.hostname).toBe('clinicapremium.com.br');
    expect(own.normalizedUrl).toBe('https://clinicapremium.com.br/');
  });

  it('RN-04 & RNF-04: valida schema estrito do SiteDocument, rejeita excessos e sanitiza XSS', () => {
    const doc = createValidSiteDocFixture();
    doc.hero.headline = 'Sorriso <script>alert("xss")</script> saudável para toda sua família';
    doc.about.description =
      'Atendimento especializado javascript:alert(1) em clínica odontológica moderna com equipamentos digitais.';

    const validated = sanitizeAndValidateSiteDocument(doc);
    expect(validated.hero.headline).not.toContain('<script>');
    expect(validated.about.description).not.toContain('javascript:');

    const invalid = createValidSiteDocFixture();
    invalid.hero.headline = 'A'.repeat(120); // Exceeds 90-char schema limit
    expect(() => sanitizeAndValidateSiteDocument(invalid)).toThrow();

    const unsafeUrl = createValidSiteDocFixture();
    unsafeUrl.hero.heroImageUrl = 'javascript:alert(1)';
    expect(() => sanitizeAndValidateSiteDocument(unsafeUrl)).toThrow();

    expect(sanitizePlainText('<b>Oi</b> <script>bad()</script>')).toBe('Oi');
    expect(clampString('Texto muito longo para título curto', 15).length).toBeLessThanOrEqual(15);
  });

  it('RF-14 & CA-08: renderiza variáveis dinâmicas e Spintax sem chaves literais residuais', () => {
    const template =
      '{Olá|Oi} equipe da {{nome_empresa}} em {{bairro}} ({{cidade}})! Criamos uma prévia para {{categoria}}: {{link_preview}} | Sair: {{link_optout}}';

    const result = renderMessageTemplate(
      template,
      {
        nome_empresa: 'Oficina Alfa',
        bairro: 'Moema',
        cidade: 'São Paulo',
        categoria: 'Oficina Mecânica',
        link_preview: 'https://oficina-alfa.preview.site/preview/oficina-alfa',
        link_optout: 'https://app.local/opt-out/tok123',
      },
      42,
    );

    expect(result.unresolved).toEqual([]);
    expect(result.rendered).toMatch(/^(Olá|Oi) equipe da Oficina Alfa em Moema \(São Paulo\)/);
    expect(result.rendered).not.toContain('{{');
    expect(result.rendered).not.toContain('}}');
    expect(result.rendered).not.toContain('{Olá|Oi}');

    const partial = renderMessageTemplate('Oi {{nome_empresa}} - {{variavel_faltante}}', {
      nome_empresa: 'Padaria Sol',
    });
    expect(partial.unresolved).toEqual(['variavel_faltante']);
  });

  it('RNF-04 & RN-10: criptografia AES-256-GCM, hash de senha scrypt e verificação HMAC de webhooks', () => {
    const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const encrypted = encryptSecret('sk-live-secret-byok-key-1234', masterKey);
    expect(encrypted.ciphertext).not.toContain('sk-live-secret');
    expect(decryptSecret(encrypted, masterKey)).toBe('sk-live-secret-byok-key-1234');

    const tampered = { ...encrypted, ciphertext: Buffer.from('tampered').toString('base64') };
    expect(() => decryptSecret(tampered, masterKey)).toThrow();

    const pwHash = hashPassword('SenhaForte@2026');
    expect(verifyPassword('SenhaForte@2026', pwHash)).toBe(true);
    expect(verifyPassword('SenhaErrada', pwHash)).toBe(false);

    const payload = JSON.stringify({ event_id: 'evt_123', type: 'payment.succeeded' });
    const secret = 'webhook_secret_test';
    const sig = `sha256=${signHmacSha256(payload, secret)}`;
    expect(verifyHmacSignature(payload, sig, secret)).toBe(true);
    expect(verifyHmacSignature(payload, 'sha256=deadbeef', secret)).toBe(false);

    const ts = '1730000000';
    const stripeSig = `t=${ts},v1=${signHmacSha256(`${ts}.${payload}`, secret)}`;
    expect(verifyHmacSignature(payload, stripeSig, secret)).toBe(true);
    expect(generateSecureToken(12).length).toBe(24);
  });

  it('RN-07: janela operacional permite Seg-Sex 08:30-18:00 BRT e reprograma fora do expediente', () => {
    // 2026-11-11 is Wednesday; 14:00 UTC == 11:00 BRT (America/Sao_Paulo, UTC-3)
    const businessTime = new Date('2026-11-11T14:00:00Z');
    const checkOk = checkOperationalWindow(businessTime, 'America/Sao_Paulo');
    expect(checkOk.allowed).toBe(true);

    // 2026-11-14 is Saturday 14:00 UTC == 11:00 BRT
    const saturday = new Date('2026-11-14T14:00:00Z');
    const checkSat = checkOperationalWindow(saturday, 'America/Sao_Paulo');
    expect(checkSat.allowed).toBe(false);
    expect(checkSat.nextWindowDate.getTime()).toBeGreaterThan(saturday.getTime());

    // 2026-11-11 22:30 UTC == 19:30 BRT (after 18:00)
    const lateNight = new Date('2026-11-11T22:30:00Z');
    const checkNight = checkOperationalWindow(lateNight, 'America/Sao_Paulo');
    expect(checkNight.allowed).toBe(false);
    expect(checkNight.nextWindowDate.getTime()).toBeGreaterThan(lateNight.getTime());
  });

  it('RN-01 & RN-05 & CA-05: grid geo determinístico e fallback para imagens >= 800px por nicho', async () => {
    const p1 = resolveApproximateCoordinates({ city: 'São Paulo', state: 'SP', neighborhood: 'Pinheiros' });
    const p2 = resolveApproximateCoordinates({ city: 'Sao Paulo', state: 'SP', neighborhood: 'Pinheiros' });
    expect(p1.lat).toBe(p2.lat);
    expect(p1.lng).toBe(p2.lng);

    const g1 = computeGeoGridKey({ lat: p1.lat, lng: p1.lng, radiusKm: 5, keyword: 'Clínica Odontológica' });
    const g2 = computeGeoGridKey({ lat: p2.lat, lng: p2.lng, radiusKm: 5, keyword: 'clinica odontologica' });
    expect(g1).toBe(g2);
    expect(slugifyBusinessName('São José Açaí & Grill')).toBe('sao-jose-acai-grill');

    // CA-05: 0 fotos -> fallback do acervo do nicho (todas isStockFallback = true, caminhos /stock/...)
    const fallback0 = await resolveSiteImages({
      niche: 'oficinas',
      businessName: 'Auto Center Exemplo',
      rawPhotos: [],
    });
    expect(fallback0.heroImageUrl).toMatch(/^\/stock\/oficinas\/[1-3]\.webp$/);
    expect(fallback0.gallery.every((g) => g.isStockFallback)).toBe(true);

    // CA-05: Foto < 800px descartada -> fallback do acervo do nicho
    const fallbackLowRes = await resolveSiteImages({
      niche: 'clinicas',
      businessName: 'Clínica Exemplo',
      rawPhotos: [{ url: 'https://example.invalid/thumb.jpg', width: 400, height: 300 }],
    });
    expect(fallbackLowRes.heroImageUrl).toMatch(/^\/stock\/clinicas\/[1-3]\.webp$/);
    expect(fallbackLowRes.gallery[0]?.isStockFallback).toBe(true);
  });
});

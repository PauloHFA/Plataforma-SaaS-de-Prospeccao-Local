import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp, type AppRuntime } from '../../apps/api/src/app.js';
import { loadConfig } from '../../apps/api/src/config.js';
import { leads, notifications, sites, usageTelemetry } from '@plataforma/db';
import {
  buildSignedSandboxWebhook,
  registerSimulatedDnsDomain,
} from '@plataforma/integrations';
import { findUnresolvedVariables } from '@plataforma/shared';

async function loginUser(runtime: AppRuntime, email: string, password: string): Promise<string> {
  const res = await runtime.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

describe('Critérios de Aceite (CA-01 a CA-12) + RN/RF/RNF End-to-End API', () => {
  let runtime: AppRuntime;
  let alphaToken = '';
  let betaToken = '';
  let adminToken = '';

  beforeAll(async () => {
    runtime = await buildApp({
      databaseUrl: 'memory://',
      queueDriver: 'memory',
      embedWorkers: true,
      seed: true,
    });
    alphaToken = await loginUser(runtime, 'operador@alfa.com.br', 'Operador@123');
    betaToken = await loginUser(runtime, 'operador@beta.com.br', 'Operador@123');
    adminToken = await loginUser(runtime, 'admin@plataforma.com.br', 'Admin@123456');
  });

  afterAll(async () => {
    await runtime.close();
  });

  it('CA-01, CA-02, CA-03 & RN-01: Busca geolocalizada filtra sem site próprio, valida WhatsApp, deduplica sem cobrar créditos e reutiliza cache geo compartilhado', async () => {
    // Primeiro: buscar com filtro ALL apenas para confirmar que existem OWN_DOMAIN no provider
    const usageBefore = await runtime.app.inject({
      method: 'GET',
      url: '/api/settings/usage',
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    const initialCredits = usageBefore.json().tenant.creditsBalance as number;

    // CA-01: Tenant Alpha busca Clínicas Odontológicas em São Paulo com filtro WITHOUT_OWN_SITE
    const searchRes = await runtime.app.inject({
      method: 'POST',
      url: '/api/leads/search',
      headers: { Authorization: `Bearer ${alphaToken}` },
      payload: {
        keyword: 'Clínica Odontológica',
        city: 'São Paulo',
        state: 'SP',
        radiusKm: 5,
        limit: 10,
        websiteFilter: 'WITHOUT_OWN_SITE',
        waitForValidation: true,
      },
    });
    expect(searchRes.statusCode).toBe(200);
    const body1 = searchRes.json();
    expect(body1.stats.cacheHit).toBe(false);
    expect(body1.leads.length).toBeGreaterThanOrEqual(6);

    // Nenhuma empresa com OWN_DOMAIN pode aparecer na listagem filtrada
    const categories = new Set(body1.leads.map((l: any) => l.websiteCategory));
    expect(categories.has('OWN_DOMAIN')).toBe(false);
    expect(categories.has('NO_WEBSITE')).toBe(true);
    expect(categories.has('SOCIAL_ONLY')).toBe(true);

    // CA-02: Telefones fixos marcados com whatsappValid === false; móveis válidos com whatsappValid === true
    const landlineLeads = body1.leads.filter((l: any) => l.phoneType === 'LANDLINE');
    const mobileLeads = body1.leads.filter((l: any) => l.phoneType === 'MOBILE');
    expect(landlineLeads.length).toBeGreaterThan(0);
    expect(mobileLeads.length).toBeGreaterThan(0);
    for (const ll of landlineLeads) {
      expect(ll.whatsappValid).toBe(false);
    }
    for (const ml of mobileLeads) {
      expect(ml.whatsappValid).toBe(true);
      expect(ml.phoneE164).toMatch(/^\+55\d{11}$/);
    }

    // CA-03: Re-executar exatamente a mesma busca no mesmo Tenant Alpha -> cacheHit=true e 0 novos créditos cobrados
    const creditsAfterFirst = (
      await runtime.app.inject({
        method: 'GET',
        url: '/api/settings/usage',
        headers: { Authorization: `Bearer ${alphaToken}` },
      })
    ).json().tenant.creditsBalance as number;
    expect(creditsAfterFirst).toBe(initialCredits - body1.stats.newInserted);

    const repeatRes = await runtime.app.inject({
      method: 'POST',
      url: '/api/leads/search',
      headers: { Authorization: `Bearer ${alphaToken}` },
      payload: {
        keyword: 'Clínica Odontológica',
        city: 'São Paulo',
        state: 'SP',
        radiusKm: 5,
        limit: 10,
        websiteFilter: 'WITHOUT_OWN_SITE',
        waitForValidation: true,
      },
    });
    expect(repeatRes.statusCode).toBe(200);
    const body2 = repeatRes.json();
    expect(body2.stats.cacheHit).toBe(true);
    expect(body2.stats.newInserted).toBe(0);
    expect(body2.stats.deduplicated).toBe(body1.leads.length);
    expect(body2.stats.creditsConsumed).toBe(0);

    // Credits balance unchanged on deduplicated search
    const creditsAfterRepeat = (
      await runtime.app.inject({
        method: 'GET',
        url: '/api/settings/usage',
        headers: { Authorization: `Bearer ${alphaToken}` },
      })
    ).json().tenant.creditsBalance as number;
    expect(creditsAfterRepeat).toBe(creditsAfterFirst);

    // RN-01: Tenant Beta busca mesma região + categoria -> compartilha geo_search_cache (cacheHit: true)
    // mas cria seus próprios leads isolados no workspace Beta!
    const betaSearch = await runtime.app.inject({
      method: 'POST',
      url: '/api/leads/search',
      headers: { Authorization: `Bearer ${betaToken}` },
      payload: {
        keyword: 'Clínica Odontológica',
        city: 'São Paulo',
        state: 'SP',
        radiusKm: 5,
        limit: 10,
        websiteFilter: 'WITHOUT_OWN_SITE',
        waitForValidation: true,
      },
    });
    expect(betaSearch.statusCode).toBe(200);
    expect(betaSearch.json().stats.cacheHit).toBe(true);
    expect(betaSearch.json().stats.newInserted).toBe(body1.leads.length);
  });

  it('CA-04, CA-05, CA-06, CA-07 & RN-06: Gera site SPA com IA, aplica fallback >=800px, edita no preview imediato e move funil ao clicar no WhatsApp', async () => {
    const leadsRes = await runtime.app.inject({
      method: 'GET',
      url: '/api/leads',
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    const allAlphaLeads = leadsRes.json().leads as any[];

    // Escolher um lead com 0 fotos ou foto baixa resolução para validar CA-05 junto com CA-04
    const leadNoPhoto = allAlphaLeads.find((l) => Array.isArray(l.photosJson) && l.photosJson.length === 0) || allAlphaLeads[0];
    expect(leadNoPhoto).toBeDefined();

    // CA-04: Gerar SPA com IA (medindo tempo <= 20s RNF-01)
    const started = Date.now();
    const genRes = await runtime.app.inject({
      method: 'POST',
      url: '/api/sites/generate',
      headers: { Authorization: `Bearer ${alphaToken}` },
      payload: { leadId: leadNoPhoto.id },
    });
    const elapsedMs = Date.now() - started;
    expect(genRes.statusCode).toBe(201);
    expect(elapsedMs).toBeLessThan(20_000);

    const { site, previewUrl } = genRes.json();
    expect(site.status).toBe('PREVIEW');
    expect(previewUrl).toContain(`/preview/${site.subdomainSlug}`);

    // CA-05: Fallback de imagem curada temática do nicho quando lead não tem fotos ou resolução < 800px
    expect(site.contentJson.hero.heroImageUrl).toMatch(/^\/stock\/[a-z_]+\/[1-3]\.webp$/);
    expect(site.contentJson.gallery.every((g: any) => g.isStockFallback)).toBe(true);

    // Funil deve ter avançado para SITE_GERADO
    const leadDetailAfterGen = await runtime.app.inject({
      method: 'GET',
      url: `/api/leads/${leadNoPhoto.id}`,
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    expect(leadDetailAfterGen.json().lead.funnelStage).toBe('SITE_GERADO');

    // CA-06: Edição rápida pré-envio altera título hero e cor primária e reflete imediatamente na API pública
    const patchRes = await runtime.app.inject({
      method: 'PATCH',
      url: `/api/sites/${site.id}`,
      headers: { Authorization: `Bearer ${alphaToken}` },
      payload: {
        primaryColor: '#be123c',
        contentPatch: {
          hero: {
            headline: 'Atendimento odontológico de excelência no seu bairro hoje mesmo',
          },
        },
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const updatedSite = patchRes.json().site;
    expect(updatedSite.contentJson.theme.primaryColor).toBe('#be123c');

    const publicRes = await runtime.app.inject({
      method: 'GET',
      url: `/api/public/sites/by-slug/${site.subdomainSlug}`,
    });
    expect(publicRes.statusCode).toBe(200);
    expect(publicRes.headers['cache-control']).toBe('no-store');
    expect(publicRes.json().site.contentJson.hero.headline).toBe(
      'Atendimento odontológico de excelência no seu bairro hoje mesmo',
    );
    expect(publicRes.json().site.contentJson.theme.primaryColor).toBe('#be123c');

    // CA-07: Simular acesso ao preview + clique no botão WhatsApp flutuante -> move para PREVIEW_VISUALIZADO + notificação
    const pvRes = await runtime.app.inject({
      method: 'POST',
      url: '/api/public/telemetry',
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' },
      payload: { siteId: site.id, eventType: 'PAGE_VIEW' },
    });
    expect(pvRes.statusCode).toBe(200);
    expect(pvRes.json().previewViewsCount).toBe(1);

    const waClickRes = await runtime.app.inject({
      method: 'POST',
      url: '/api/public/telemetry',
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' },
      payload: { siteId: site.id, eventType: 'WHATSAPP_CLICK' },
    });
    expect(waClickRes.statusCode).toBe(200);
    expect(waClickRes.json().whatsappClicksCount).toBe(1);

    const leadAfterTelemetry = (
      await runtime.app.inject({
        method: 'GET',
        url: `/api/leads/${leadNoPhoto.id}`,
        headers: { Authorization: `Bearer ${alphaToken}` },
      })
    ).json().lead;
    expect(leadAfterTelemetry.funnelStage).toBe('PREVIEW_VISUALIZADO');

    const notifRes = await runtime.app.inject({
      method: 'GET',
      url: '/api/notifications',
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    const notifications = notifRes.json().notifications as any[];
    expect(notifications.some((n) => n.siteId === site.id && n.type === 'WHATSAPP_CLICK')).toBe(true);
    expect(notifications.some((n) => n.siteId === site.id && n.type === 'PREVIEW_OPENED')).toBe(true);

    const telemetryRes = await runtime.app.inject({
      method: 'GET',
      url: `/api/sites/${site.id}/telemetry`,
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    expect(telemetryRes.statusCode).toBe(200);
    expect(telemetryRes.json().byDevice.mobile).toBeGreaterThanOrEqual(2);
  });

  it('CA-08, CA-09 & RN-08: Dispara campanha com Spintax e bloqueia telefone fixo, lead em quarentena e opt-out LGPD', async () => {
    const connsRes = await runtime.app.inject({
      method: 'GET',
      url: '/api/connections',
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    const waConn = connsRes.json().connections.find(
      (c: any) => c.channel === 'WHATSAPP_EVOLUTION' && c.status === 'CONNECTED',
    );
    expect(waConn).toBeDefined();

    const leadsRes = await runtime.app.inject({
      method: 'GET',
      url: '/api/leads',
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    const allLeads = leadsRes.json().leads as any[];

    const mobileLeads = allLeads.filter((l) => l.whatsappValid === true);
    const landlineLead = allLeads.find((l) => l.phoneType === 'LANDLINE');
    expect(mobileLeads.length).toBeGreaterThanOrEqual(3);
    expect(landlineLead).toBeDefined();

    const eligibleLead = mobileLeads[0];
    const quarantineLead = mobileLeads[1];
    const optOutLead = mobileLeads[2];

    // Colocar quarantineLead em quarentena (contatado há 5 dias < 30 dias)
    await runtime.dbCtx.db
      .update(leads)
      .set({ lastContactedAt: new Date(Date.now() - 5 * 86_400_000) })
      .where(eq(leads.id, quarantineLead.id));

    // Marcar optOutLead via resposta com palavra-chave no webhook (RN-08 / CA-09)
    const inboundOptOut = await runtime.app.inject({
      method: 'POST',
      url: '/api/webhooks/messaging/evolution',
      payload: {
        tenantId: optOutLead.tenantId,
        fromPhoneE164: optOutLead.phoneE164,
        inboundText: 'PARAR por favor, remover meu número',
      },
    });
    expect(inboundOptOut.statusCode).toBe(200);

    // CA-08: Criar e executar campanha para 4 leads (1 elegível, 1 fixo, 1 quarentena, 1 opt-out)
    const campRes = await runtime.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: { Authorization: `Bearer ${alphaToken}` },
      payload: {
        name: 'Campanha Odontologia Pinheiros',
        channel: 'WHATSAPP',
        connectionId: waConn.id,
        bodyTemplate:
          '{Olá|Oi} equipe da {{nome_empresa}} em {{bairro}} ({{cidade}})! Criamos uma prévia para {{categoria}}: {{link_preview}} | Descadastrar: {{link_optout}}',
        leadIds: [eligibleLead.id, landlineLead.id, quarantineLead.id, optOutLead.id],
        minDelayMs: 50,
        maxDelayMs: 60,
        respectBusinessHours: false,
        waitForCompletion: true,
      },
    });
    expect(campRes.statusCode).toBe(201);
    const campId = campRes.json().campaign.id as string;

    const detailRes = await runtime.app.inject({
      method: 'GET',
      url: `/api/campaigns/${campId}`,
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    expect(detailRes.statusCode).toBe(200);
    const dispatches = detailRes.json().dispatches as any[];

    const dispEligible = dispatches.find((d) => d.leadId === eligibleLead.id);
    const dispLandline = dispatches.find((d) => d.leadId === landlineLead.id);
    const dispQuarantine = dispatches.find((d) => d.leadId === quarantineLead.id);
    const dispOptOut = dispatches.find((d) => d.leadId === optOutLead.id);

    expect(dispEligible.status).toBe('SENT');
    expect(findUnresolvedVariables(dispEligible.renderedBody)).toEqual([]);
    expect(dispEligible.renderedBody).toContain(eligibleLead.businessName);
    expect(dispEligible.renderedBody).not.toContain('{{');

    expect(dispLandline.status).toBe('BLOCKED_NO_WHATSAPP');
    expect(dispQuarantine.status).toBe('BLOCKED_QUARANTINE');
    expect(dispOptOut.status).toBe('BLOCKED_OPT_OUT');

    // CA-09: Link público de opt-out também bloqueia outro lead imediatamente
    const extraMobile = mobileLeads[3];
    if (extraMobile) {
      const publicOpt = await runtime.app.inject({
        method: 'POST',
        url: `/api/public/opt-out/${extraMobile.optOutToken}`,
      });
      expect(publicOpt.statusCode).toBe(200);
      expect(publicOpt.json().optedOut).toBe(true);
    }
  });

  it('CA-10, CA-11, RN-10, RN-11, RN-12 & RF-20: Checkout HMAC idempotente publica site, verifica domínio DNS+SSL, suporta Portal Cliente e suspensão graciosa', async () => {
    const sitesRes = await runtime.app.inject({
      method: 'GET',
      url: '/api/sites',
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    const site = sitesRes.json().sites[0];
    expect(site).toBeDefined();

    // RF-17: Criar oferta híbrida (Setup R$ 497 + R$ 97/mês)
    const offerRes = await runtime.app.inject({
      method: 'POST',
      url: '/api/checkout/offers',
      headers: { Authorization: `Bearer ${alphaToken}` },
      payload: {
        siteId: site.id,
        gateway: 'SANDBOX',
        billingModel: 'HYBRID',
        setupAmountCents: 49700,
        monthlyAmountCents: 9700,
      },
    });
    expect(offerRes.statusCode).toBe(201);
    const offer = offerRes.json().offer;

    // RN-10: Webhook com assinatura HMAC inválida deve ser rejeitado (401)
    const badWebhook = await runtime.app.inject({
      method: 'POST',
      url: '/api/webhooks/payments/sandbox',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'sha256=invalidsignaturedeadbeef',
      },
      payload: {
        event_id: 'evt_bad_1',
        type: 'payment.succeeded',
        data: { offer_token: offer.token, amount_cents: 59400 },
      },
    });
    expect(badWebhook.statusCode).toBe(401);

    // CA-10 + RN-10: Webhook assinado válido confirma pagamento e publica o site
    const signedWebhook = buildSignedSandboxWebhook({
      eventId: 'evt_ca10_paid_1',
      eventType: 'payment.succeeded',
      offerToken: offer.token,
      amountCents: 59400,
      secret: runtime.config.sandboxWebhookSecret,
    });

    const goodWebhook = await runtime.app.inject({
      method: 'POST',
      url: '/api/webhooks/payments/sandbox',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': signedWebhook.signatureHeader,
      },
      payload: signedWebhook.rawBody,
    });
    expect(goodWebhook.statusCode).toBe(200);
    expect(goodWebhook.json().siteStatus).toBe('PUBLISHED');
    const clientPortalUrl = goodWebhook.json().clientPortalUrl as string;
    const portalToken = clientPortalUrl.split('/portal/')[1]!;

    // RN-10: Reenvio idêntico do mesmo event_id é ignorado com segurança
    const replayWebhook = await runtime.app.inject({
      method: 'POST',
      url: '/api/webhooks/payments/sandbox',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': signedWebhook.signatureHeader,
      },
      payload: signedWebhook.rawBody,
    });
    expect(replayWebhook.statusCode).toBe(200);
    expect(replayWebhook.json().idempotent).toBe(true);

    // Public API agora serve PUBLISHED com cache CDN
    const pubAfterPay = await runtime.app.inject({
      method: 'GET',
      url: `/api/public/sites/by-slug/${site.subdomainSlug}`,
    });
    expect(pubAfterPay.json().site.status).toBe('PUBLISHED');
    expect(pubAfterPay.headers['cache-control']).toContain('s-maxage=60');

    // CA-11: Configurar domínio próprio e simular propagação DNS CNAME + SSL ativo
    const customHost = 'clinicaodontologica.exemplo.com.br';
    const domainCfgRes = await runtime.app.inject({
      method: 'POST',
      url: `/api/sites/${site.id}/domain`,
      headers: { Authorization: `Bearer ${alphaToken}` },
      payload: { domain: customHost },
    });
    expect(domainCfgRes.statusCode).toBe(200);
    expect(domainCfgRes.json().instructions.cname.target).toBe(runtime.config.platformCnameTarget);

    registerSimulatedDnsDomain(customHost);
    const verifyRes = await runtime.app.inject({
      method: 'POST',
      url: `/api/sites/${site.id}/domain/verify`,
      headers: { Authorization: `Bearer ${alphaToken}` },
      payload: {},
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().domain.dnsStatus).toBe('VERIFIED');
    expect(verifyRes.json().domain.sslStatus).toBe('ACTIVE');

    // Caddy On-Demand TLS ask endpoint aprova o domínio customizado verificado
    const caddyAsk = await runtime.app.inject({
      method: 'GET',
      url: `/internal/caddy/ask?domain=${customHost}`,
    });
    expect(caddyAsk.statusCode).toBe(200);
    expect(caddyAsk.json().allowed).toBe(true);

    // By-host resolve o site corretamente pelo domínio próprio
    const byHostRes = await runtime.app.inject({
      method: 'GET',
      url: `/api/public/sites/by-host?host=${customHost}`,
    });
    expect(byHostRes.statusCode).toBe(200);
    expect(byHostRes.json().site.id).toBe(site.id);

    // RF-20: Portal Simplificado do Cliente Final edita telefone e cria solicitação
    const portalUpdate = await runtime.app.inject({
      method: 'PATCH',
      url: `/api/portal/${portalToken}/site`,
      payload: {
        phoneDisplay: '(11) 99988-7766',
        whatsappNumber: '+5511999887766',
      },
    });
    expect(portalUpdate.statusCode).toBe(200);
    expect(portalUpdate.json().site.contentJson.business.phoneDisplay).toBe('(11) 99988-7766');

    const portalReq = await runtime.app.inject({
      method: 'POST',
      url: `/api/portal/${portalToken}/requests`,
      payload: { requestType: 'CONTENT_ADJUSTMENT', message: 'Atualizar horário de sábado para 09h-13h.' },
    });
    expect(portalReq.statusCode).toBe(201);

    // RN-12: Webhook de inadimplência após carência suspende graciosamente e mantém dados
    const failWebhook = buildSignedSandboxWebhook({
      eventId: 'evt_past_due_1',
      eventType: 'invoice.payment_failed',
      offerToken: offer.token,
      amountCents: 9700,
      secret: runtime.config.sandboxWebhookSecret,
    });
    const pastDueBody = JSON.stringify({
      ...JSON.parse(failWebhook.rawBody),
      data: { ...JSON.parse(failWebhook.rawBody).data, grace_days: 0 },
    });
    const { verifyHmacSignature } = await import('@plataforma/shared/crypto');
    const { signHmacSha256 } = await import('@plataforma/shared/crypto');
    const pastDueSig = `sha256=${signHmacSha256(pastDueBody, runtime.config.sandboxWebhookSecret)}`;
    expect(verifyHmacSignature(pastDueBody, pastDueSig, runtime.config.sandboxWebhookSecret)).toBe(true);

    const overdueRes = await runtime.app.inject({
      method: 'POST',
      url: '/api/webhooks/payments/sandbox',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': pastDueSig,
      },
      payload: pastDueBody,
    });
    expect(overdueRes.statusCode).toBe(200);

    const suspendedCheck = await runtime.app.inject({
      method: 'GET',
      url: `/api/public/sites/by-slug/${site.subdomainSlug}`,
    });
    expect(suspendedCheck.json().site.status).toBe('SUSPENDED');
    expect(suspendedCheck.json().site.contentJson.business.phoneDisplay).toBe('(11) 99988-7766');

    // Reativação pelo portal do cliente restaura PUBLISHED com todos os dados intactos
    const reactivateRes = await runtime.app.inject({
      method: 'POST',
      url: `/api/portal/${portalToken}/subscription`,
      payload: { action: 'REACTIVATE' },
    });
    expect(reactivateRes.statusCode).toBe(200);
    expect(reactivateRes.json().status).toBe('PUBLISHED');

    // RN-11: Expiração automática arquiva preview antigo sem visualizações
    const tenantAlphaSite2 = await runtime.app.inject({
      method: 'GET',
      url: '/api/leads',
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    const secondLead = tenantAlphaSite2.json().leads.find((l: any) => !l.site);
    if (secondLead) {
      const s2Res = await runtime.app.inject({
        method: 'POST',
        url: '/api/sites/generate',
        headers: { Authorization: `Bearer ${alphaToken}` },
        payload: { leadId: secondLead.id },
      });
      const s2Id = s2Res.json().site.id as string;
      await runtime.dbCtx.db
        .update(sites)
        .set({ expiresAt: new Date(Date.now() - 86_400_000) })
        .where(eq(sites.id, s2Id));

      const lifecycleRes = await runtime.app.inject({
        method: 'POST',
        url: '/api/admin/lifecycle/run',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { task: 'expire-previews' },
      });
      expect(lifecycleRes.statusCode).toBe(200);
      expect(lifecycleRes.json().affectedCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('CA-12, RBAC (1.2), BYOK (RN-09) & RNF-07: Isolamento estrito Multi-Tenant, bloqueio por orçamento e permissões de Admin', async () => {
    const alphaLeads = (
      await runtime.app.inject({
        method: 'GET',
        url: '/api/leads',
        headers: { Authorization: `Bearer ${alphaToken}` },
      })
    ).json().leads as any[];
    const alphaLeadId = alphaLeads[0].id as string;

    const alphaSites = (
      await runtime.app.inject({
        method: 'GET',
        url: '/api/sites',
        headers: { Authorization: `Bearer ${alphaToken}` },
      })
    ).json().sites as any[];
    const alphaSiteId = alphaSites[0].id as string;

    // CA-12: Tenant Beta NÃO pode acessar nem modificar Lead ou Site do Tenant Alpha
    const crossLeadGet = await runtime.app.inject({
      method: 'GET',
      url: `/api/leads/${alphaLeadId}`,
      headers: { Authorization: `Bearer ${betaToken}` },
    });
    expect(crossLeadGet.statusCode).toBe(404);

    const crossSitePatch = await runtime.app.inject({
      method: 'PATCH',
      url: `/api/sites/${alphaSiteId}`,
      headers: { Authorization: `Bearer ${betaToken}` },
      payload: { primaryColor: '#000000' },
    });
    expect(crossSitePatch.statusCode).toBe(404);

    // RBAC 1.2: TENANT_OPERATOR recebe 403 ao tentar rotas administrativas
    const operatorAdminTry = await runtime.app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    expect(operatorAdminTry.statusCode).toBe(403);

    // GLOBAL_ADMIN acessa métricas globais, filas e audit logs
    const adminOverview = await runtime.app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminOverview.statusCode).toBe(200);
    expect(adminOverview.json().metrics.totalTenants).toBeGreaterThanOrEqual(2);
    expect(adminOverview.json().queues.length).toBe(5);

    // RNF-04 + RN-09: Salvar chave BYOK AES-256-GCM retorna hint mascarado, nunca texto plano
    const byokPut = await runtime.app.inject({
      method: 'PUT',
      url: '/api/settings/secrets/openai',
      headers: { Authorization: `Bearer ${alphaToken}` },
      payload: { secretValue: 'sk-proj-alpha-secret-token-987654' },
    });
    expect(byokPut.statusCode).toBe(200);
    expect(byokPut.json().secret.keyHint).toBe('sk-p••••7654');
    expect(JSON.stringify(byokPut.json())).not.toContain('sk-proj-alpha-secret-token');

    // RNF-07: Orçamento mensal estourado bloqueia novas buscas preventivamente (402)
    const betaUsage = (
      await runtime.app.inject({
        method: 'GET',
        url: '/api/settings/usage',
        headers: { Authorization: `Bearer ${betaToken}` },
      })
    ).json();
    const betaTenantId = betaUsage.tenant.id as string;

    await runtime.dbCtx.db.insert(usageTelemetry).values({
      tenantId: betaTenantId,
      metricType: 'LLM_GENERATION',
      units: 1,
      estimatedCostCents: 999_999,
      usedByok: false,
    });

    const blockedSearch = await runtime.app.inject({
      method: 'POST',
      url: '/api/leads/search',
      headers: { Authorization: `Bearer ${betaToken}` },
      payload: { keyword: 'Restaurante', city: 'Curitiba', state: 'PR' },
    });
    expect(blockedSearch.statusCode).toBe(402);
  });

  it('Hardening & Produtividade: fail-fast de segredo em produção, rate limit 429, geração em lote, upload WebP no portal e resolução de solicitações', async () => {
    // 1. Fail-fast de segredos padrão em NODE_ENV=production
    const prevEnv = {
      NODE_ENV: process.env.NODE_ENV,
      JWT_SECRET: process.env.JWT_SECRET,
      ENCRYPTION_MASTER_KEY: process.env.ENCRYPTION_MASTER_KEY,
      ALLOW_DEV_SECRETS: process.env.ALLOW_DEV_SECRETS,
    };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;
      delete process.env.ENCRYPTION_MASTER_KEY;
      delete process.env.ALLOW_DEV_SECRETS;
      expect(() => loadConfig()).toThrow(/JWT_SECRET inseguro/i);

      process.env.JWT_SECRET = 'prod-strong-jwt-secret-0123456789abcdef';
      expect(() => loadConfig()).toThrow(/ENCRYPTION_MASTER_KEY padrão/i);

      process.env.ENCRYPTION_MASTER_KEY = 'prod-strong-aes-master-key-0123456789';
      expect(() => loadConfig()).not.toThrow();
    } finally {
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }

    // 2. Sliding-window rate limit em /api/auth/login -> 429 + Retry-After
    const rlRuntime = await buildApp({
      databaseUrl: 'memory://',
      queueDriver: 'memory',
      embedWorkers: true,
      seed: true,
      rateLimitMaxAuth: 3,
    });
    try {
      for (let i = 0; i < 3; i++) {
        const res = await rlRuntime.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'operador@alfa.com.br', password: 'WrongPassword' },
        });
        expect(res.statusCode).toBe(401);
      }
      const throttled = await rlRuntime.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'operador@alfa.com.br', password: 'WrongPassword' },
      });
      expect(throttled.statusCode).toBe(429);
      expect(throttled.headers['retry-after']).toBeDefined();
    } finally {
      await rlRuntime.close();
    }

    // 3. Geração em lote de sites SPA (pula os já existentes)
    const leadsListRes = await runtime.app.inject({
      method: 'GET',
      url: '/api/leads',
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    const allAlphaLeads = leadsListRes.json().leads as Array<{ id: string; site: unknown }>;
    const existingLead = allAlphaLeads.find((l) => Boolean(l.site));
    const eligibleLeads = allAlphaLeads.filter((l) => !l.site).slice(0, 2);
    expect(eligibleLeads.length).toBeGreaterThanOrEqual(1);

    const batchPayloadIds = [
      ...(existingLead ? [existingLead.id] : []),
      ...eligibleLeads.map((l) => l.id),
    ];
    const batchRes = await runtime.app.inject({
      method: 'POST',
      url: '/api/sites/generate-batch',
      headers: { Authorization: `Bearer ${alphaToken}` },
      payload: { leadIds: batchPayloadIds, waitForCompletion: true },
    });
    expect(batchRes.statusCode).toBe(202);
    expect(batchRes.json().queuedCount).toBe(eligibleLeads.length);
    if (existingLead) {
      expect(batchRes.json().skippedCount).toBeGreaterThanOrEqual(1);
    }
    expect([...(batchRes.json().queuedLeadIds as string[])].sort()).toEqual(
      eligibleLeads.map((l) => l.id).sort(),
    );

    const leadsAfterBatch = (
      await runtime.app.inject({
        method: 'GET',
        url: '/api/leads',
        headers: { Authorization: `Bearer ${alphaToken}` },
      })
    ).json().leads as Array<{ id: string; site: { id: string } | null }>;
    for (const el of eligibleLeads) {
      expect(leadsAfterBatch.find((l) => l.id === el.id)?.site?.id).toBeTruthy();
    }

    // 4. Upload de imagem no Portal do Cliente -> WebP + solicitação gera notificação e permite resolução
    const alphaSites = (
      await runtime.app.inject({
        method: 'GET',
        url: '/api/sites',
        headers: { Authorization: `Bearer ${alphaToken}` },
      })
    ).json().sites as Array<{ id: string; clientPortalToken: string | null }>;
    const portalSite = alphaSites.find((s) => Boolean(s.clientPortalToken))!;
    expect(portalSite).toBeDefined();

    // 1x1 transparent PNG válido
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const boundary = '----PlataformaIntegrationBoundary';
    const multipartBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fachada.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      tinyPng,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await runtime.app.inject({
      method: 'POST',
      url: `/api/portal/${portalSite.clientPortalToken}/media`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody,
    });
    expect(uploadRes.statusCode).toBe(201);
    expect(uploadRes.json().url).toMatch(/^\/api\/media\/tenants\/.*\.webp$/);
    expect(uploadRes.json().site.contentJson.hero.heroImageUrl).toBe(uploadRes.json().url);

    // Criar nova solicitação no portal -> notificação criada + listada em GET /api/sites/:id
    const createReqRes = await runtime.app.inject({
      method: 'POST',
      url: `/api/portal/${portalSite.clientPortalToken}/requests`,
      payload: {
        requestType: 'INFO_UPDATE',
        message: 'Trocar telefone principal e atualizar banner de entrada.',
      },
    });
    expect(createReqRes.statusCode).toBe(201);
    const createdReqId = createReqRes.json().request.id as string;

    const notifRows = await runtime.dbCtx.db
      .select()
      .from(notifications)
      .where(eq(notifications.siteId, portalSite.id));
    expect(notifRows.some((n) => n.type === 'NEW_CLIENT_REQUEST')).toBe(true);

    const detailWithReq = await runtime.app.inject({
      method: 'GET',
      url: `/api/sites/${portalSite.id}`,
      headers: { Authorization: `Bearer ${alphaToken}` },
    });
    expect(detailWithReq.statusCode).toBe(200);
    expect(
      (detailWithReq.json().clientRequests as Array<{ id: string; status: string }>).some(
        (r) => r.id === createdReqId && r.status === 'OPEN',
      ),
    ).toBe(true);

    // Cross-tenant não pode resolver solicitação de outro workspace
    const crossResolve = await runtime.app.inject({
      method: 'PATCH',
      url: `/api/sites/${portalSite.id}/requests/${createdReqId}`,
      headers: { Authorization: `Bearer ${betaToken}` },
      payload: { status: 'DONE' },
    });
    expect(crossResolve.statusCode).toBe(404);

    // Operador Alpha marca solicitação como DONE
    const resolveRes = await runtime.app.inject({
      method: 'PATCH',
      url: `/api/sites/${portalSite.id}/requests/${createdReqId}`,
      headers: { Authorization: `Bearer ${alphaToken}` },
      payload: { status: 'DONE' },
    });
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().request.status).toBe('DONE');
  });
});

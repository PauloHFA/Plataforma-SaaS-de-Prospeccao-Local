import { test, expect, type Page } from '@playwright/test';

function attachRuntimeErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on('response', (resp) => {
    if (resp.status() >= 400 && !resp.url().includes('openstreetmap')) {
      errors.push(`HTTP_${resp.status()}: ${resp.url()}`);
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      if (!txt.includes('ERR_ABORTED') && !txt.includes('openstreetmap')) {
        errors.push(`CONSOLE_ERROR: ${txt}`);
      }
    }
  });
  return errors;
}

test.describe('E2E Full-Stack Browser Verification (Playwright)', () => {
  test('Jornada completa: Captação Geo -> Editor Rápido -> Preview & Telemetria -> Funil -> Checkout & Publicação -> Portal -> Admin', async ({
    browser,
    page,
  }) => {
    const errors = attachRuntimeErrorCollector(page);

    // 1. Login como Operador do Workspace Alfa (Tenant A)
    await page.goto('/login');
    await expect(page.getByText('Entrar no LocalSites AI')).toBeVisible();
    await page.getByRole('button', { name: 'Agência Alfa (Tenant A)' }).click();
    await page.getByRole('button', { name: /Entrar/i }).click();
    await page.waitForURL('**/dashboard');
    await expect(page.getByText('Visão Geral Operacional')).toBeVisible();

    // 2. Captação Geográfica e Higienização (CA-01, CA-02)
    await page.goto('/leads');
    await page.getByTestId('search-keyword-input').fill('Clínica Odontológica');
    await page.getByTestId('search-city-input').fill('São Paulo');
    await page.getByTestId('search-website-filter').selectOption('WITHOUT_OWN_SITE');
    await page.getByTestId('search-leads-submit').click();

    await expect(page.getByTestId('search-stats-banner')).toBeVisible();
    await expect(page.getByText('Sem Website').first()).toBeVisible();
    await expect(page.getByText('Domínio Próprio')).toHaveCount(0);
    await expect(page.getByText('WhatsApp Ativo').first()).toBeVisible();
    await expect(page.getByText('Fixo (Ligar / E-mail)').first()).toBeVisible();

    // 3. Gerar Site SPA com IA para o primeiro lead elegível (CA-04)
    const generateBtn = page.getByRole('button', { name: 'Gerar Site IA' }).first();
    await generateBtn.click();
    await page.waitForURL('**/sites/*/editor');
    await expect(page.getByText(/Editor Rápido:/)).toBeVisible();

    // Extrair slug do preview link
    const previewHref = await page.getByTestId('open-public-preview-link').getAttribute('href');
    expect(previewHref).toBeTruthy();
    const previewPath = previewHref!.split('?')[0]!;

    // 4. Editor Rápido Pré-Envio: editar headline + cor primária (CA-06)
    const editedHeadline = 'Sorriso renovado e atendimento humanizado no seu bairro hoje';
    await page.getByTestId('editor-headline-input').fill(editedHeadline);
    await page.getByTestId('editor-primary-color-hex').fill('#BE123C');
    await page.getByTestId('save-site-editor-btn').click();
    await expect(page.getByText(/Alterações salvas e cache público invalidado/i)).toBeVisible();

    // 5. Prospect acessa /preview/[slug] em contexto anônimo (Mobile 375x812 + Desktop 1440x900)
    const mobileCtx = await browser.newContext({
      viewport: { width: 375, height: 812 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const mobilePage = await mobileCtx.newPage();
    const mobileErrors = attachRuntimeErrorCollector(mobilePage);

    const navStart = Date.now();
    await mobilePage.goto(previewPath);
    await mobilePage.waitForLoadState('networkidle');
    const navElapsed = Date.now() - navStart;
    expect(navElapsed).toBeLessThan(5000);

    // Verificar atualização imediata (CA-06) e marca d'água + noindex (RN-06)
    await expect(mobilePage.getByRole('heading', { level: 1 })).toHaveText(editedHeadline);
    await expect(mobilePage.getByTestId('preview-watermark-banner')).toBeVisible();
    const robotsMeta = await mobilePage.locator('meta[name="robots"]').getAttribute('content');
    expect(robotsMeta).toContain('noindex');

    // Verificar JSON-LD LocalBusiness (RF-08)
    const ldJsonCount = await mobilePage.locator('script[type="application/ld+json"]').count();
    expect(ldJsonCount).toBeGreaterThanOrEqual(1);

    // Verificar imagens carregadas sem erro e sem fallback quebrado (CA-05)
    // Rolar até cada imagem para acionar IntersectionObserver de loading="lazy"
    const imgLocators = mobilePage.locator('img');
    const imgTotal = await imgLocators.count();
    for (let idx = 0; idx < imgTotal; idx++) {
      await imgLocators.nth(idx).scrollIntoViewIfNeeded();
    }
    await mobilePage.waitForFunction(() =>
      Array.from(document.querySelectorAll('img')).every((img) => img.complete && img.naturalWidth > 0),
    );
    await mobilePage.evaluate(() => window.scrollTo(0, 0));
    const imgChecks = await mobilePage.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.map((img) => ({
        src: img.getAttribute('src'),
        complete: img.complete,
        naturalWidth: img.naturalWidth,
      }));
    });
    expect(imgChecks.length).toBeGreaterThanOrEqual(1);
    for (const ic of imgChecks) {
      expect(ic.complete).toBe(true);
      expect(ic.naturalWidth).toBeGreaterThan(0);
      if (ic.src?.startsWith('/stock/')) {
        expect(ic.naturalWidth).toBeGreaterThanOrEqual(800);
      }
    }

    // Verificar zero overflow horizontal em 375px
    const mobileOverflow = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(mobileOverflow).toBeLessThanOrEqual(1);

    // Verificar também Desktop 1440x900 sem overflow
    await mobilePage.setViewportSize({ width: 1440, height: 900 });
    const desktopOverflow = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(desktopOverflow).toBeLessThanOrEqual(1);

    // CA-07: Clicar no botão flutuante de WhatsApp no preview (capturando telemetry request)
    const telemetryReqPromise = mobilePage.waitForResponse(
      (resp) => resp.url().includes('/api/public/telemetry') && resp.status() === 200,
    );
    await mobilePage.getByTestId('floating-whatsapp-btn').click();
    await telemetryReqPromise;

    expect(mobileErrors).toEqual([]);
    await mobileCtx.close();

    // 6. De volta ao painel autenticado: Notificações + Kanban PREVIEW_VISUALIZADO (CA-07)
    await page.reload();
    await expect(page.getByTestId('notifications-bell')).toBeVisible();
    await page.getByTestId('notifications-bell').click();
    await expect(page.getByText(/clicou no WhatsApp/i).first()).toBeVisible();

    await page.goto('/pipeline');
    const previewViewedCol = page.getByTestId('kanban-col-PREVIEW_VISUALIZADO');
    await expect(previewViewedCol).toBeVisible();
    await expect(previewViewedCol).toContainText('1');

    // Alternar para aba Lista (RF-06)
    await page.getByTestId('pipeline-list-tab').click();
    await expect(page.getByRole('table')).toBeVisible();

    // 7. Abrir drawer do lead em PREVIEW_VISUALIZADO -> Editor -> Checkout -> Site Publicado sem watermark (CA-10)
    await page.getByTestId('pipeline-kanban-tab').click();
    await previewViewedCol.locator('[data-testid^="kanban-card-"]').first().click();
    await page.getByRole('link', { name: 'Editor', exact: true }).click();
    await page.waitForURL('**/sites/*/editor');

    await page.getByRole('button', { name: /Disparo, Checkout & Domínio/i }).click();
    await page.getByRole('button', { name: 'Gerar Link de Checkout' }).click();
    const checkoutHref = await page.getByRole('link', { name: /Abrir Checkout:/i }).getAttribute('href');
    expect(checkoutHref).toBeTruthy();

    await page.goto(checkoutHref!);
    await page.getByTestId('confirm-payment-btn').click();
    await expect(page.getByTestId('checkout-paid-success')).toBeVisible();

    // Abrir site publicado e confirmar remoção da tarja de prévia + indexação liberada (CA-10)
    const portalHref = await page.getByRole('link', { name: 'Acessar Portal do Cliente' }).getAttribute('href');
    await page.goto(previewPath);
    await expect(page.getByTestId('preview-watermark-banner')).toHaveCount(0);
    const pubRobots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(pubRobots).toContain('index');
    expect(pubRobots).not.toContain('noindex');

    // 8. Portal do Cliente Final via Link Mágico (RF-20) + Solicitação de Ajuste
    expect(portalHref).toBeTruthy();
    await page.goto(portalHref!);
    await expect(page.getByText(/Portal Simplificado do Cliente/i)).toBeVisible();
    await expect(page.getByText('PUBLISHED')).toBeVisible();
    await page.getByTestId('portal-request-textarea').fill('Ajustar texto do rodapé e destaque inicial.');
    await page.getByTestId('portal-request-submit-btn').click();
    await expect(page.getByText(/Solicitação de ajuste enviada à agência/i)).toBeVisible();

    // 8.2. Lista de Sites com filtros por status e resolução da solicitação do cliente no Editor
    await page.goto('/sites');
    await expect(page.getByTestId('sites-search-input')).toBeVisible();
    await page.getByTestId('sites-filter-PUBLISHED').click();
    await page.getByRole('link', { name: 'Editor Rápido' }).first().click();
    await page.waitForURL('**/sites/*/editor');
    await page.getByRole('button', { name: /Disparo, Checkout & Domínio/i }).click();
    await expect(page.getByTestId('client-requests-section')).toBeVisible();
    await expect(page.getByText('Ajustar texto do rodapé e destaque inicial.')).toBeVisible();
    await page.locator('[data-testid^="resolve-request-btn-"]').first().click();
    await expect(page.getByText('CONCLUÍDO').first()).toBeVisible();

    // 8.3. Produtividade na tela de Leads: seleção em lote & exportação CSV
    await page.goto('/leads');
    await expect(page.getByTestId('export-leads-csv-btn')).toBeEnabled();
    const eligibleCheckbox = page.locator('tbody input[type="checkbox"]:not([disabled])').first();
    if ((await eligibleCheckbox.count()) > 0) {
      await eligibleCheckbox.check();
      await expect(page.getByTestId('batch-generate-btn')).toBeVisible();
      await page.getByTestId('batch-generate-btn').click();
      await expect(page.getByTestId('batch-generate-notice')).toBeVisible();
    }

    // 8.5. Verificar páginas de Conexões (RF-13) e Campanhas (RF-14/15) sem erros
    await page.goto('/connections');
    await expect(page.getByRole('button', { name: /Adicionar Conexão/i })).toBeVisible();
    await page.goto('/campaigns');
    await expect(page.getByText(/Campanhas, Templates Dinâmicos & Cadência/i)).toBeVisible();

    // 9. Console Administrativo Global (RBAC 1.2)
    await page.goto('/login');
    await page.getByRole('button', { name: 'Admin Global' }).click();
    await page.getByRole('button', { name: /Entrar/i }).click();
    await page.waitForURL('**/admin');
    await expect(page.getByText(/Administração Global da Plataforma/i)).toBeVisible();
    await expect(page.getByText(/Agência Alfa/i).first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});

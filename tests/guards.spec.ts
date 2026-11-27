import { test, expect } from '@playwright/test';

// Guards que não dependem de viewport: rodam só nos 3 motores para não
// inflar a matriz de 11 aparelhos (o resto da suíte cobre os devices).
const ENGINES = ['chromium', 'firefox', 'webkit'];

test.describe('Guards de motor', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !ENGINES.includes(testInfo.project.name),
      'guarda independente de device (roda nos 3 motores)'
    );
  });

  test('home não busca fontes no Google (self-hosted)', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (req) => requested.push(req.url()));

    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const google = requested.filter((u) => /fonts\.(googleapis|gstatic)\.com/.test(u));
    expect(google).toEqual([]);
    // Positivo: as webfonts saem do próprio domínio (/_astro/fonts/*.woff2).
    expect(requested.some((u) => /\.woff2/.test(u))).toBe(true);
  });

  test('404 responde com a página customizada', async ({ page }) => {
    const response = await page.goto('/rota-que-nao-existe');
    expect(response?.status()).toBe(404);

    await expect(page.locator('main h1')).toContainText('Fora de');
    await expect(page.locator('main a[href="/"]')).toBeVisible();
  });

  test('rotas órfãs do blog respondem 404 sem redirect', async ({ page }) => {
    for (const route of ['/search', '/posts', '/category/qualquer', '/tag/qualquer']) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(404);
      await expect(page, route).toHaveURL(new RegExp(`${route}$`));
      await expect(page.locator('main h1'), route).toContainText('Fora de');
    }
  });

  test('página inexistente responde 404 direto e mantém a URL', async ({ page }) => {
    const response = await page.goto('/pages/nao-existe');
    expect(response?.status()).toBe(404);

    await expect(page).toHaveURL(/\/pages\/nao-existe$/);
    await expect(page.locator('main h1')).toContainText('Fora de');
  });

  test('prefers-reduced-motion: conteúdo visível sem transição', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const title = page.locator('#inicio h1');
    await expect
      .poll(async () => Number(await title.evaluate((el) => getComputedStyle(el).opacity)))
      .toBeGreaterThan(0.9);

    const duration = await title.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration.split(',').every((d) => d.trim() === '0s')).toBe(true);
  });

  test('sem exceção JavaScript não tratada na home', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('/');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForTimeout(1000);

    expect(pageErrors).toEqual([]);
  });
});

// Headers e gate de analytics não dependem de viewport: um caso por recurso,
// fora da matriz de aparelhos.
test.describe('Headers de segurança', () => {
  test('HTML da home recebe HSTS e CSP', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();

    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');

    const csp = headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  test('robots.txt também recebe HSTS (o layout de página não alcança)', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.headers()['strict-transport-security']).toContain('max-age=');
  });

  test('/uploads mantém a política própria da rota', async ({ request }) => {
    const response = await request.get('/uploads');
    const headers = response.headers();

    // A rota é de recebimento de arquivo: nada de embed, nada de índice.
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-robots-tag']).toContain('noindex');
    expect(headers['cache-control']).toContain('no-store');
  });
});

test.describe('Gate do GA4', () => {
  test('fora do host canônico o GA não é injetado', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (req) => requested.push(req.url()));

    await page.goto('/', { waitUntil: 'load' });

    // Preview, dev e localhost nunca contam visita: nem o snippet, nem o script.
    const html = await page.content();
    expect(html).not.toContain('G-RJDVRMXRM6');
    expect(requested.some((url) => url.includes('googletagmanager.com/gtag/js'))).toBe(false);
  });
});

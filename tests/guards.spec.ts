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

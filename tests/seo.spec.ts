import { test, expect } from '@playwright/test';

test.describe('SEO e infraestrutura', () => {
  test('RSS feed responde com idioma pt-BR e link atom normalizado', async ({ request }) => {
    const res = await request.get('/rss.xml');
    expect(res.status()).toBe(200);

    const body = await res.text();
    expect(body).toContain('<language>pt-BR</language>');
    // O site é resolvido pelo `site` do astro.config; antes da correção a URL vinha
    // com barra dupla (...com.br//rss.xml) porque URL.toString() adiciona "/" final.
    expect(body).not.toContain('com.br//');
    expect(body).toMatch(/<atom:link href="[^"]+\/rss\.xml" rel="self"/);
  });

  test('sitemap.xml responde sem erro', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('<sitemapindex');
  });

  test('URLs de âncora são reescritas para a home', async ({ page }) => {
    for (const section of ['portfolio', 'sobre', 'servicos', 'contato']) {
      const res = await page.goto(`/${section}`);
      expect(res?.status()).toBe(200);
      await expect(page.locator('#inicio')).toBeVisible();
    }
  });
});

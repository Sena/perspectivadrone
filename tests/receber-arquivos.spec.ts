import { test, expect } from "@playwright/test";

const API = "/_emdash/api/plugins/receber-arquivos";

test.describe("Receber arquivos", () => {
  test("/uploads responde noindex e oferece o seletor de arquivo", async ({ page }) => {
    const response = await page.goto("/uploads");
    expect(response?.status()).toBe(200);

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(response?.headers()["x-robots-tag"] ?? "").toContain("noindex");

    await expect(page.getByRole("heading", { name: /Envie seu material/i })).toBeVisible();

    // Cota estourada mostra "Envios temporariamente fechados"; fora disso o
    // formulário aparece — e nunca pede senha.
    const fileInput = page.locator("#ra-file");
    if ((await fileInput.count()) > 0) {
      await expect(fileInput).toHaveAttribute("type", "file");
      await expect(page.locator("#ra-password")).toHaveCount(0);
    } else {
      await expect(page.getByText(/Envios temporariamente fechados/i)).toBeVisible();
    }
  });

  test("robots.txt bloqueia /uploads e o endpoint de download", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body).toContain("Disallow: /uploads");
    expect(body).toContain("Disallow: /api/receber-arquivos/");
  });

  test("rota de status é pública e informa os limites", async ({ request }) => {
    const response = await request.get(`${API}/status`);
    expect(response.ok()).toBeTruthy();

    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.ok).toBe(true);
    expect(payload.data.maxFileSize).toBeGreaterThan(0);
    expect(payload.data.quotaBytes).toBeGreaterThan(0);
  });

  test("download exige sessão de administrador", async ({ request }) => {
    const response = await request.get("/api/receber-arquivos/arquivo-inexistente");
    expect([401, 403]).toContain(response.status());
    expect(response.headers()["x-robots-tag"] ?? "").toContain("noindex");
  });
});

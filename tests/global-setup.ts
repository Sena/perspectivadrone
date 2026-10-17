import type { FullConfig } from '@playwright/test';

/**
 * Aquece o alvo uma vez, antes de qualquer worker subir.
 *
 * O dev server compila as rotas na primeira visita — em rodada fria isso custa
 * dezenas de segundos e, com a suíte em rajada, a compilação disputa CPU com os
 * browsers: os primeiros goto estouram timeout (medido nesta máquina de 4 cores:
 * 8/12 falhas em rodada fria vs 12/12 com o alvo aquecido antes). Serializar
 * UMA request aqui elimina a corrida de forma determinística, para qualquer
 * máquina, sem depender de config do sistema. Se o dev server não estiver de
 * pé, o erro aponta o caminho (PLAYWRIGHT_TEST_BASE_URL para outra porta).
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects.find((project) => project.use?.baseURL)?.use.baseURL ??
    process.env.PLAYWRIGHT_TEST_BASE_URL ??
    'http://localhost:4321';

  const startedAt = Date.now();
  const deadline = startedAt + 240_000; // typegen + primeiro render frio já custou ~100s
  let lastError = 'sem resposta';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/`, {
        signal: AbortSignal.timeout(120_000),
        headers: { 'cache-control': 'no-cache' },
      });
      if (response.ok) {
        await response.text();
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[global-setup] alvo aquecido: ${baseURL} (HTTP ${response.status}, ${seconds}s)`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error(
    `[global-setup] alvo não respondeu em 4 min: ${baseURL} (último erro: ${lastError}). ` +
      'Subiu o dev server? Se estiver em outra porta, use PLAYWRIGHT_TEST_BASE_URL.'
  );
}

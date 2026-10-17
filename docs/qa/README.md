# QA da vitrine — runbook

A suíte vive em `tests/` (Playwright) e cobre os fluxos públicos do one-pager:
interações (lightbox, formulário de contato, menu, scroll-spy) e regressão visual.
Achados fora do padrão ficam em `docs/BACKLOG.md` com id (`BUG-001`…).

## Como rodar

1. Suba o dev server em um terminal — a suíte **não** sobe servidor sozinha (decisão
   antiga por causa de processos zumbis no Windows; ver BUG-003).
2. Em outro terminal:

```bash
npx playwright test                       # suíte completa (6 projetos)
npx playwright test tests/visual.spec.ts  # só os visuais
npx playwright test --update-snapshots    # regenerar baselines — SOMENTE dentro do Docker (ver abaixo)
```

## O que a suíte cobre

| Arquivo | Conteúdo |
| --- | --- |
| `tests/home.spec.ts` | 8 testes de interação: lightbox (clique/teclado/swipe), validação e envio do formulário de contato, menu mobile, SEO/acessibilidade essenciais, scroll-spy da navbar |
| `tests/visual.spec.ts` | 2 comparações visuais: homepage completa e hero |
| `tests/seo.spec.ts` | RSS (idioma, link sem barra dupla), sitemap e rewrite das âncoras (`/portfolio` → home) |

Cada teste roda nos 11 projetos: desktops `chromium` (1280×720), `Desktop 1366`
(1366×768), `firefox`, `webkit`; mobiles `Galaxy S8` (Android 360×740),
`iPhone SE` (375×667), `Mobile Safari` (iPhone 12 / 390×664), `Mobile Chrome`
(Pixel 5 / 393×727), `iPhone 14 Pro Max` (430×740); tablets `Tablet (iPad)`
(810×1080) e `Tablet (iPad) landscape` (1080×810).

As larguras cobrem os buckets mais comuns do mercado (360→430 px no mobile):
quebra de linha é sensível à largura — foi assim que o incidente de paridade
de rendering (2026-10-17) apareceu.

## Baselines visuais

- Tolerância `maxDiffPixelRatio: 0.08`, mas a **dimensão da página precisa bater exata**.
- **Regra de ouro**: baseline só nasce/atualiza **dentro do container** (Linux). O rendering
  de fonte difere entre Windows e Linux (métricas de glifo → largura de texto → quebra de
  linha): um baseline gerado no Windows quebra o CI (ex.: +1 linha por card no Pixel 5).
  O CI roda a **mesma imagem** do fluxo Docker local (`playwright:v1.60.0-jammy`), então a
  regeneração local e o CI são byte-idênticos.
- Para paridade com o CI (Linux) regenere dentro do Docker:

```bash
docker-compose exec perspectivadrone-linux npx playwright test tests/visual.spec.ts --update-snapshots --workers=1
```

- Contra uma preview própria (`npx wrangler versions upload`), passe a URL:

```bash
$env:PLAYWRIGHT_TEST_BASE_URL = "https://<version>-perspectivadrone2.flaviosena.workers.dev"
npx playwright test
```

## Ambientes

| Ambiente | baseURL | Observação |
| --- | --- | --- |
| Local | `http://localhost:4321` | dev server manual; banco em `.wrangler` (pode ser clone do prod via `npm run sync -- pull --apply`) |
| Preview | `https://<version>-perspectivadrone2.flaviosena.workers.dev` | `wrangler versions upload`; **herda os bindings de produção** — atenção: uma preview com EmDash 1.x migra o D1 de produção no primeiro request (BUG-006) |
| CI | URL extraída do check do Cloudflare | `.github/workflows/playwright.yml`; container `mcr.microsoft.com/playwright:v1.60.0-jammy` (mesma imagem do Docker local; `HOME=/root` p/ o Firefox lançar como root) |

## Achados conhecidos

- **Flake de teardown no Windows**: `worker-N process did not exit within 300000ms after stop, force-killed` — a suíte passa, mas o run ganha ~5 min no final (BUG-003).
- Demais pendências com evidência: `docs/BACKLOG.md`.

## Histórico

- **2026-10-17 (cobertura de aparelhos)** — suíte ampliada de 6 para 11 projetos: `Galaxy S8`
  (Android 360), `iPhone SE` (375), `iPhone 14 Pro Max` (430), `Tablet (iPad) landscape` e
  `Desktop 1366`. 13 testes × 11 projetos = **143 testes**. As 10 baselines novas foram
  geradas dentro do container jammy e os 12 arquivos existentes saíram byte-idênticos;
  ferramenta permanente `Regen Visual Baselines` (`workflow_dispatch`) adicionada para
  futuras regenerações.
- **2026-10-17 (paridade de rendering)** — primeiro run real da suíte visual no CI (BUG-005
  destravado) expôs `homepage-full-Mobile-Chrome.png` regenerado **no Windows** (`38b8550`,
  393×7026) contra o render **Linux** do CI (393×7071; +2 linhas nos cards de serviço,
  22,75px cada). Causa: métricas de fonte Windows vs Linux — não era bug do site. Correção:
  baseline restaurado (o de maio é **byte-idêntico** ao render do container jammy) e o job de
  testes passou a rodar no container `playwright:v1.60.0-jammy` (mesmo do Docker local).
- **2026-10-17** — upgrade EmDash 0.14 → 1.3 validado: suíte **60/60** local (com o banco
  clonado da produção via sync) e 59/60 na preview própria — a única falha era o baseline
  `homepage-full-Mobile-Chrome.png` desatualizado, regenerado na sequência e re-verificado verde.
- **2026-10-17 (pós-pente fino)** — com as correções desta rodada e o `tests/seo.spec.ts` novo:
  suíte **78/78** local (14 min), mesmo com o flake de teardown (3 workers force-killed no fim, BUG-003).

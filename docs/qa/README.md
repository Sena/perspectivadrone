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
npx playwright test --update-snapshots    # regenerar baselines (ver Docker abaixo)
```

## O que a suíte cobre

| Arquivo | Conteúdo |
| --- | --- |
| `tests/home.spec.ts` | 8 testes de interação: lightbox (clique/teclado/swipe), validação e envio do formulário de contato, menu mobile, SEO/acessibilidade essenciais, scroll-spy da navbar |
| `tests/visual.spec.ts` | 2 comparações visuais: homepage completa e hero |
| `tests/seo.spec.ts` | RSS (idioma, link sem barra dupla), sitemap e rewrite das âncoras (`/portfolio` → home) |

Cada teste roda nos 6 projetos: `chromium`, `firefox`, `webkit`,
`Mobile Chrome` (Pixel 5), `Mobile Safari` (iPhone), `Tablet (iPad)`.

## Baselines visuais

- Tolerância `maxDiffPixelRatio: 0.08`, mas a **dimensão da página precisa bater exata**.
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
| CI | URL extraída do check do Cloudflare | `.github/workflows/playwright.yml`; hoje bloqueado por BUG-005 |

## Achados conhecidos

- **Flake de teardown no Windows**: `worker-N process did not exit within 300000ms after stop, force-killed` — a suíte passa, mas o run ganha ~5 min no final (BUG-003).
- Demais pendências com evidência: `docs/BACKLOG.md`.

## Histórico

- **2026-10-17** — upgrade EmDash 0.14 → 1.3 validado: suíte **60/60** local (com o banco
  clonado da produção via sync) e 59/60 na preview própria — a única falha era o baseline
  `homepage-full-Mobile-Chrome.png` desatualizado, regenerado na sequência e re-verificado verde.
- **2026-10-17 (pós-pente fino)** — com as correções desta rodada e o `tests/seo.spec.ts` novo:
  suíte **78/78** local (14 min), mesmo com o flake de teardown (3 workers force-killed no fim, BUG-003).

# Perspectiva Drone

Site institucional de fotografia e filmagem aérea com drone. Construído com **Astro 5**, **EmDash CMS**, **Tailwind CSS v4** e hospedado no **Cloudflare Workers** com banco de dados **D1** e armazenamento de mídia **R2**.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | Astro 5 (SSR, `output: "server"`) |
| CMS | EmDash (`emdash ^0.14`) |
| Estilização | Tailwind CSS v4 (via Vite plugin) |
| Animações | GSAP 3.12 + ScrollTrigger (CDN) |
| Runtime | Cloudflare Workers |
| Banco de dados | Cloudflare D1 (SQLite) |
| Armazenamento | Cloudflare R2 |
| Package manager | pnpm |

---

## Estrutura do projeto

```
perspectivadrone/
├── seed/
│   └── seed.json          # Schema do CMS + conteúdo demo
├── src/
│   ├── components/
│   │   └── perspectiva/   # Componentes da landing page
│   │       ├── Hero.astro
│   │       ├── PortfolioGrid.astro
│   │       ├── ServicesGrid.astro
│   │       ├── About.astro
│   │       ├── ContactForm.astro
│   │       └── Navbar.astro
│   ├── layouts/
│   │   └── Base.astro     # Layout base com head/body EmDash
│   ├── pages/
│   │   └── index.astro    # Página principal (single-page)
│   └── styles/
│       └── theme.css      # Tokens de design, cores, tipografia
├── astro.config.mjs        # Config Astro + EmDash + Cloudflare
└── wrangler.jsonc          # Config Cloudflare Workers/D1/R2
```

### Coleções do CMS

| Coleção | Descrição |
|---|---|
| `pages` | Seções de conteúdo (hero, sobre, cta, contato) |
| `portfolio` | Trabalhos fotográficos com imagem e metadados |
| `services` | Serviços oferecidos com ícone e ordem |

---

## Ambiente local

### Pré-requisitos

- Node.js ≥ 18
- pnpm (`npm i -g pnpm`)
- Conta Cloudflare (para deploy)

### Instalação

```bash
pnpm install
```

### Inicializar banco e seed (primeira vez)

```bash
emdash init && npx emdash seed seed/seed.json
```

Isso cria o banco D1 local (`data.db`) e popula com o conteúdo de `seed/seed.json`.

### Subir o servidor de desenvolvimento

```bash
pnpm run dev
# ou
npx emdash dev   # roda migrations + seed + tipos antes de iniciar
```

Acesso: [http://localhost:4321](http://localhost:4321)

### Admin do CMS

```
http://localhost:4321/_emdash/admin
```

Se precisar de acesso sem senha (dev):

```
http://localhost:4321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin
```

### Regenerar tipos TypeScript

```bash
npx emdash types
# arquivo gerado: emdash-env.d.ts
```

---

## Deploy no Cloudflare

### Pré-requisitos de infraestrutura

Os recursos abaixo precisam existir no seu painel Cloudflare antes do primeiro deploy.

**1. Banco D1**

```bash
wrangler d1 create perspectivadrone
```

Cole o `database_id` gerado no `wrangler.jsonc`.

**2. Bucket R2**

```bash
wrangler r2 bucket create perspectivadrone
```

Já configurado no `wrangler.jsonc` com `bucket_name: "perspectivadrone"`.

### Deploy manual (build + deploy + seed remoto)

```bash
pnpm run deploy:prod
# equivale a: astro build && wrangler deploy && npx emdash seed seed/seed.json --remote
```

Esse comando:
1. Gera o build de produção em `./dist`
2. Faz deploy do Worker no Cloudflare
3. Aplica o seed no banco D1 **remoto**

### Só build + deploy (sem aplicar seed)

```bash
pnpm run deploy
# equivale a: astro build && wrangler deploy
```

Use quando o conteúdo já está no banco remoto e você só quer atualizar o código.

### Validar o seed antes de aplicar

```bash
npx emdash seed seed/seed.json --validate
```

### Limpeza de dados locais

```bash
pnpm run cleanup          # limpa dados locais
pnpm run cleanup:prod     # limpa dados remotos (cuidado!)
```

---

## Testes (Playwright)

O projeto possui configuração completa de **E2E e Visual Regression Tests** usando o Playwright (`playwright.config.ts`).

### Como rodar os testes

> **Aviso Importante:** O Playwright foi configurado para **NÃO** iniciar automaticamente o servidor (`npm run dev`) por conta de bugs de processos zumbis no Windows. Você precisa subir o projeto manualmente antes de testar.

1. Em um terminal, inicie o projeto localmente:
   ```bash
   pnpm run dev
   ```
2. Em **outro** terminal, execute os testes:
   ```bash
   npx playwright test
   ```

### Atualizando as baselines visuais
Se você alterar o CSS propositalmente e um teste visual falhar, você pode atualizar as fotos de referência executando:
```bash
npx playwright test --update-snapshots
```

### Integração Contínua (CI) com Cloudflare Workers

O projeto possui um workflow configurado no GitHub Actions (`.github/workflows/playwright.yml`) que automatiza a execução de todos os testes E2E em Pull Requests e Commits.

O fluxo de CI funciona da seguinte forma:
1. O Cloudflare gera uma URL temporária via **Workers Builds**.
2. Quando o *Check Run* do Cloudflare é concluído com sucesso, o GitHub Actions é engatilhado.
3. A URL gerada é extraída dinamicamente e injetada no Playwright através da variável de ambiente `PLAYWRIGHT_TEST_BASE_URL`.
4. Todos os testes visuais e E2E rodam diretamente na versão hospedada, validando o comportamento real antes de qualquer merge.

---

## Convenções importantes

- **Todas as páginas são SSR** — sem `getStaticPaths()` para conteúdo CMS.
- **Imagens** são objetos `{ src, alt }`, não strings. Use `<Image image={...} />` de `emdash/ui`.
- **`entry.id`** = slug (para URLs). **`entry.data.id`** = ULID do banco (para chamadas de API).
- Sempre chamar `Astro.cache.set(cacheHint)` em páginas que consultam conteúdo.
- Taxonomy names nas queries devem bater com o campo `"name"` do seed (ex: `"category"`).

---

## Animações GSAP

As animações são carregadas via CDN (sem bundle) e controladas por classes CSS:

| Classe | Elemento | Efeito |
|---|---|---|
| `.gsap-hero` | `<section>` do Hero | âncora do ScrollTrigger de parallax |
| `.gsap-parallax` | `div` do background | parallax de profundidade no scroll |
| `.gsap-hero-content` | conteúdo do Hero | fade + slide-up na entrada da página |
| `.gsap-reveal` | headers de seção | fade-in ao entrar na viewport |
| `.gsap-card` | cards do portfólio | stagger cascade ao scrollar |
| `.corner-frame` | SVG interno dos cards | borda "desenhada" no hover (stroke-dashoffset) |
| `#portfolio-lightbox` | Lightbox (Slide) | Galeria nativa em tela cheia via JSVanilla Vanilla |

> O GSAP é carregado dinamicamente com um guard `window.__gsapLoaded` para evitar carregamento duplicado em navegações SPA.

---

## Segurança (Content Security Policy - CSP)

O projeto possui uma política CSP rígida implementada no `src/layouts/Base.astro`. Esta política bloqueia a execução de fontes e scripts externos não autorizados, mitigando riscos de XSS.

Se você precisar adicionar uma nova ferramenta (ex: Pixel do Meta, Hotjar, nova fonte externa), você **obrigatoriamente** precisa adicionar os domínios do serviço no objeto de whitelist `cspDomains` contido no `Base.astro`:

```javascript
// src/layouts/Base.astro
const cspDomains = {
  scripts: [
    "https://www.googletagmanager.com", 
    "https://cdn.jsdelivr.net",
    "https://static.cloudflareinsights.com",
    // "https://connect.facebook.net" <- adicione aqui
  ],
  // ...
```

A diretiva `unsafe-inline` é permitida globalmente, mas restrita aos domínios aprovados neste array.

---

## Variáveis de ambiente

Não há `.env` necessário para desenvolvimento local — o EmDash usa o `data.db` local automaticamente.

Para produção, as credenciais são gerenciadas via bindings do Cloudflare (`DB`, `MEDIA`, `LOADER`) configurados no `wrangler.jsonc`.

---

## Troubleshooting

### Erro: `Migration failed: duplicate column name` (banco local desatualizado)

O banco local do D1 (usado pelo dev server) está em conflito com as migrações. Como usamos Cloudflare D1, o estado local fica na pasta `.wrangler` (e não apenas no `data.db`). Apague os caches e reinicialize:

```bash
# PowerShell
Remove-Item -Force data.db
Remove-Item -Recurse -Force .wrangler
Remove-Item -Recurse -Force node_modules\.vite
emdash init
npx emdash seed seed/seed.json
pnpm run dev
```

> O deploy remoto **não é afetado** — o banco do Cloudflare D1 de produção é independente.

### Erro: `The file does not exist at "node_modules/.vite/deps_ssr/chunk-XXXX.js"`

Cache de dependências SSR do Vite corrompido. Ocorre após atualizações de pacotes ou mudanças de configuração.

**Fix:**

```bash
# Windows (PowerShell)
Remove-Item -Recurse -Force node_modules\.vite
pnpm run dev

# Linux/macOS
rm -rf node_modules/.vite
pnpm run dev
```

### Servidor não inicia / porta em uso

```bash
# Verificar o que está na porta 4321
netstat -ano | findstr :4321

# Subir em outra porta
pnpm run dev -- --port 3000
```

### Tipos desatualizados após mudança no seed

```bash
npx emdash types
```


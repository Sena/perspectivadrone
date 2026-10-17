This is an EmDash site -- a CMS built on Astro with a full admin UI.

## Commands

```bash
pnpm dev              # Start dev server (runs migrations, seeds on empty DB, generates types)
npx emdash types      # Regenerate TypeScript types from schema
pnpm run seed:validate  # Validate seed file (npx emdash seed seed/seed.json --validate)
npx playwright test   # Run Playwright E2E and visual tests (requires dev server running first)
npx playwright test --update-snapshots # Update visual baseline images
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

If you need a password, use this link: `http://localhost:4321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, and storage                    |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/seed.json`         | Snapshot of the live schema (`npx emdash export-seed`); the database is the source of truth |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Base layout with EmDash wiring (menus, search, page contributions)                 |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |
| `SYNC_DB.md`             | Instructions on how to pull production D1 database to local dev environment        |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Render them through `<CdnImage image={...} imageSlot={...} />` with a slot from `IMAGE_SLOTS` (`src/utils/image-variants.ts`): on the production zone the component emits a Cloudflare `/cdn-cgi/image` `srcset` plus the slot's `sizes`; everywhere else (dev, `.workers.dev` previews, which have no `/cdn-cgi/image` route) it falls back to the plain `<img>` on the original URL. Adding a new place an image is rendered means adding a slot with widths and `sizes` measured against the layout -- never guessed. The zone only answers a fixed allowlist of widths (see `image-variants.ts`): anything outside it gets the WAF block page, so prove a new width with `curl` before shipping it.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).
- **Lightbox / Galeria**: O grid de portfólio já possui um Lightbox nativo via Vanilla JS em `PortfolioGrid.astro` (com controles de teclado, botões e swipe para mobile). Não recrie galerias ou importe bibliotecas externas (como Swiper ou GLightbox) para isso.

## QA

The Playwright suite in `tests/` documents the public flows (E2E + visual regression).

- `npx playwright test` — full suite (start the dev server first; see README).
- Findings that are out of scope for the current change go to `docs/BACKLOG.md` with an id (`BUG-001`…), with evidence, instead of being fixed on the spot.
- Runbook, environments and known flakes: `docs/qa/README.md`.

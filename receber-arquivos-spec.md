# Spec — Plugin "Receber arquivos" (`/uploads`)

**Status:** implementado
**Data:** 2026-11-16

> **Desvio de implementação (2026-11-17):** o host lê e consome o corpo da rota
> **antes** de chamar o handler (`parseRouteInput`; `body: "none"` faz
> `readRouteBody(request, 0)`), então `upload/part` **não** consegue transmitir o
> corpo em stream. A fatia passou a ser de **5 MiB** (`request: { body: "bytes",
> maxBytes: 5 MiB }`, mínimo de parte do R2) em vez de 20 MB por stream; 5 GiB
> continuam em 1.024 partes, dentro do teto de 10.000. Todo o resto da spec foi
> mantido, incluindo o painel próprio e o download fora das rotas do plugin.
>
> **Correção de runtime (2026-11-17):** a checagem de estado em `/uploads` e a
> leitura de metadados no download **não** usam `fetch` para o próprio domínio:
> no Workers, uma subrequisição para o próprio host não volta para o script
> (retorna 404), o que derrubava `/uploads` na preview. As duas passaram a
> chamar o dispatcher em processo do host (`locals.emdash`):
> `handlePublicPluginApiRoute` na página e `handlePluginApiRoute` no download.
>
> **Mudança de escopo (2026-11-17):** a senha única foi **removida**. O gate
> passou a ser o **ativar/desativar do plugin**: ativo, `/uploads` aceita envio
> de quem tiver o link; desativado, página e rotas respondem 404. Configurações
> restantes: `maxFileSizeGb` e `quotaGb`. Sem campo `secret`, o plugin não
> depende mais de `EMDASH_ENCRYPTION_KEY`. As seções 7.1, 7.2 e o campo
> `password` da seção 6 descrevem o desenho antigo e ficam como histórico.
**Área:** plugin nativo EmDash + página pública + endpoints autenticados
**Nome curto / id do plugin:** `receber-arquivos` (rótulo no admin: "Receber arquivos")

---

## 1. Objetivo

Criar um canal privado para clientes enviarem material bruto (vídeos de 5 GB, e qualquer outro tipo de arquivo) sem login:

1. O dono manda um link fixo para o cliente.
2. O cliente abre `/uploads`, digita a **senha única**, escolhe um arquivo e envia.
3. O arquivo cai no R2 do site e aparece no painel do plugin ("Receber arquivos"), onde o dono baixa ou exclui.
4. A página responde com uma confirmação de envio contendo o resumo do arquivo.
5. O recurso é um **plugin** que pode ser ativado/desativado no admin; desativado, o link responde **404**.
6. `/uploads` e todo o caminho de arquivos **não podem ser indexados**.

Fora do escopo (explícito): notificação por e-mail, identificação do cliente, links por cliente, integração com a Biblioteca de Mídia do EmDash, transcodificação/player, limpeza automática.

---

## 2. Decisões fechadas

| Tema | Decisão |
| --- | --- |
| Destino dos arquivos | **Página própria do plugin** no admin (não a Biblioteca de Mídia) |
| Identificação do cliente | **Só a senha** (sem nome/e-mail) |
| Tipos aceitos | **Qualquer arquivo** |
| Notificação | **Só no painel** (sem e-mail) |
| Transporte | **Fatias de 5 MiB pelo Worker → R2 via binding `MEDIA`** (ver desvio no topo) |
| Tamanho máximo por arquivo | **5 GiB** |
| Retomada | **Retomar depois, por 24h** (mesmo navegador) |
| Local no R2 | **Bucket `MEDIA`, prefixo `uploads/<ano>/`** |
| Retenção | **Só exclusão manual** |
| Vários arquivos | **Um por vez** (com opção de enviar outro ao final) |
| Trava de cota | **Bloquear novos envios ao passar de ~8 GiB** |
| Sessão de senha | **Senha a cada envio** (sem cookie de sessão) |
| Brute force | **Atraso progressivo** (sem bloqueio rígido) |
| Acesso aos arquivos | **Só o admin baixa** (rota autenticada) |
| Plugin desativado | **HTTP 404** |
| Painel | **Só baixar** (sem player) |
| Senha | **Configurações do plugin** (campo secreto, criptografado pelo EmDash) |
| Visual | **Mesma identidade do site** (escuro, Playfair/DM Sans, dourado) |
| Noindex | **Tudo**: meta robots + `X-Robots-Tag` + `robots.txt` + sem links + fora do sitemap |
| Nome do arquivo | **Preservado e sanitizado** no storage key |
| Registro de origem | **IP + user agent** no registro do upload |
| Testes | **Playwright E2E, sem baseline visual** |

---

## 3. Restrições técnicas descobertas (com evidência)

Estas restrições definem a arquitetura; foram verificadas no código instalado, não supostas.

1. **Rotas de plugin sandboxed têm teto de 8 MiB por requisição e bufferizam o corpo.**
   `.agents/skills/creating-plugins/references/api-routes.md` e `sandbox-boundaries.md`: corpo declarado tem padrão de 1 MiB e máximo de 8 MiB. Um envio de 5 GB é impossível por esse caminho.
2. **O adapter R2 por binding não suporta URL pré-assinada.**
   `node_modules/@emdash-cms/cloudflare/src/storage/r2.ts:167` lança `NOT_SUPPORTED` em `getSignedUploadUrl`. Portanto `POST /_emdash/api/media/upload-url` cai no alvo de streaming `/_emdash/api/media/<id>/upload` (Worker), que ainda está sujeito ao limite de corpo do plano.
3. **O limite de corpo do Workers Free é 100 MB por requisição** e a cota é 100k requisições/dia (10 ms de CPU por invocação). Um 5 GB em fatias de 20 MB = ~256 requisições — folgado no dia, mas cada requisição precisa ficar bem abaixo de 100 MB.
4. **R2 Free: 10 GB de armazenamento/mês.** Um arquivo de 5 GiB consome metade da cota. É o gargalo real, não o transporte.
5. **Plugin nativo recebe o `Request` real e pode transmitir o corpo em stream.**
   `node_modules/emdash/src/plugins/types.ts:1896` (`RouteContext.request: Request`). Sem `input` declarado, o host não parseia o corpo — dá para passar `request.body` direto ao R2.
6. **Resposta "raw" de rota de plugin é bufferizada** (`pluginRouteResponseToWire` → `Uint8Array`, limite de 8 MiB). Por isso o **download** de 5 GB não pode ser rota de plugin: será um endpoint Astro do site (código confiável), com streaming do R2.
7. **O contexto de plugin não expõe banco nem repositório de mídia.**
   `PluginContext` (`types.ts:1057`) só tem `storage`, `kv`, `settings`, `media`, `content` etc. `ctx.media.upload()` exige os bytes em memória (limite de leitura de 10–16 MiB) e `getUploadUrl()` depende de storage com URL assinada. **Não existe API para registrar um objeto já existente do R2 como item de mídia** — daí a página própria do plugin (decisão do usuário).
8. **Registro de plugin desativado some das rotas.**
   `emdash-runtime.ts:6314` (`getPluginRouteMeta`) retorna `null` quando `isPluginEnabled(pluginId)` é falso; o estado fica em `_plugin_state` (`plugins/state.ts`). Ou seja, desativar no admin já entrega 404 nas rotas do plugin.
9. **Plugin nativo é registrado como descritor com `entrypoint` de módulo** (`virtual-modules.ts:286` faz `import ... from "<entrypoint>"`). O padrão documentado é pacote npm; para código local, a forma segura é um pacote de workspace.
10. **Admin de plugin nativo usa export React (`pages?: Record<string, JSX.Element>`, `types.ts:2253`).** `@cloudflare/kumo`/`@phosphor-icons` não estão instalados neste repo; a página do admin deve usar React + HTML/Tailwind simples, sem essas dependências.

---

## 4. Arquitetura

### 4.1 Componentes

```
plugins/receber-arquivos/            ← pacote de workspace (plugin nativo)
  package.json                       name @perspectiva/receber-arquivos, exports "." e "./admin"
  src/index.ts                       descriptor + definePlugin (rotas, storage, settings, hooks)
  src/schemas.ts                     Zod dos corpos JSON
  src/password.ts                    comparação em tempo constante + atraso progressivo
  src/r2.ts                          multipart: create/resume/uploadPart/complete/abort
  src/storage.ts                     modelo e consultas da coleção `uploads`
  src/routes/upload-*.ts             start/status/part/complete/abort (públicas)
  src/routes/admin-*.ts              list/delete/stats (privadas)
  src/admin.tsx                      export `pages` (tela "Receber arquivos")

src/pages/uploads.astro              ← página pública do cliente (server-rendered)
src/components/receber-arquivos/
  UploadForm.astro                   markup + estados (senha, arquivo, progresso, sucesso)
  upload-client.ts                   cliente: fatiamento, retry, retomada, progresso
src/pages/api/receber-arquivos/[id].ts ← download autenticado (stream do R2)
public/robots.txt                    ← Disallow: /uploads e /api/receber-arquivos

astro.config.mjs                     ← plugins: [formsPlugin(), receberArquivosPlugin()]
pnpm-workspace.yaml                  ← packages: ".", "plugins/*"
```

### 4.2 Por que plugin nativo (e não sandboxed)

- 8 MiB por rota inviabiliza o upload.
- Precisa de streaming do `Request` para o R2.
- Precisa de página no site e de renderização própria.
- Não precisa de marketplace/registry: é um recurso do site.

### 4.3 Registro

`plugins/receber-arquivos/package.json`:

```json
{
  "name": "@perspectiva/receber-arquivos",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts", "./admin": "./src/admin.tsx" }
}
```

`astro.config.mjs`:

```js
import { receberArquivosPlugin } from "@perspectiva/receber-arquivos";
// ...
plugins: [formsPlugin(), receberArquivosPlugin()],
```

`receberArquivosPlugin()` retorna o descritor:

```ts
{
  id: "receber-arquivos",
  version: "0.1.0",
  entrypoint: "@perspectiva/receber-arquivos",
  adminEntry: "@perspectiva/receber-arquivos/admin",
  capabilities: [],                    // sem media:*, sem rede, sem email
  adminPages: [{ path: "/", label: "Receber arquivos", icon: "inbox" }],
  storage: {
    uploads: { indexes: ["status", "createdAt", ["status", "createdAt"]],
               uniqueIndexes: ["storageKey"] },
  },
}
```

> Fallback documentado: se o pacote de workspace atrapalhar o build Cloudflare, registrar o descritor com caminho absoluto calculado em `astro.config.mjs` (`fileURLToPath(new URL(...))`). Decidir no primeiro commit, não no meio da implementação.

### 4.4 Contrato das rotas

Montagem: `/_emdash/api/plugins/receber-arquivos/<rota>`. Envelope JSON do host (`{ success, data }`) nas rotas JSON.

| Método | Rota | Auth | Corpo / query | Retorno |
| --- | --- | --- | --- | --- |
| GET | `status` | pública | — | `{ ok, maxFileSize, quotaBytes, usedBytes, closed }` |
| POST | `upload/start` | pública | JSON `{ password, filename, size, contentType }` | `{ uploadId, token, partSize, expiresAt, uploadedParts }` |
| GET | `upload/status` | pública | query `uploadId, token` | `{ status, uploadedParts, receivedBytes }` |
| PUT | `upload/part` | pública | **stream cru**, query `uploadId, partNumber, token`, header `Content-Length` | `{ partNumber, etag }` |
| POST | `upload/complete` | pública | JSON `{ uploadId, token, parts: [{ partNumber, etag }] }` | `{ id, filename, size, storageKey }` |
| POST | `upload/abort` | pública | JSON `{ uploadId, token }` | `{ ok }` |
| GET | `admin/list` | privada `plugins:read` | query `cursor, limit` | `{ items, nextCursor, totalBytes }` |
| GET | `admin/stats` | privada `plugins:read` | — | `{ totalBytes, quotaBytes, count }` |
| POST | `admin/delete` | privada `plugins:manage` | JSON `{ id }` | `{ ok, deleted: true }` |

Regras:

- `upload/part` **não declara `input` nem `request.body`** — declará-los bufferiza e mata o upload grande. Metadados vão na query string; o corpo é lido como `request.body`.
- `upload/part` exige `Content-Length`; sem ele, responder `411 LENGTH_REQUIRED` (o R2 precisa de stream de tamanho fixo).
- Todas as rotas públicas validam método; erro de método → 405.
- Erros de domínio retornam objeto estável (`{ ok: false, error: "INVALID_PASSWORD" }`), não `throw` com detalhes.

---

## 5. Fluxo de upload

### 5.1 Passo a passo

1. **Página carrega** (`GET /uploads`): verifica se o plugin está ativo (ver 8.1). Ativo → renderiza o formulário. Inativo → 404.
2. **Senha + arquivo**: o cliente digita a senha e escolhe **um** arquivo. O cliente lê `size`, `type`, `name` e calcula um *fingerprint* local (`name|size|lastModified`).
3. **`POST upload/start`**:
   - aplica atraso progressivo (7.2);
   - compara a senha (7.1);
   - valida `size <= maxFileSize` (padrão 5 GiB) e `size > 0`;
   - valida cota (7.4);
   - verifica duplicata por `filename + size` em estado `pending|ready` — se existir, retorna `DUPLICATE` com aviso não bloqueante; o cliente pergunta "enviar mesmo assim?", que repete o start com `confirmDuplicate: true`;
   - cria registro `pending` e o multipart no R2 (`createMultipartUpload`);
   - devolve `uploadId`, `token` (opaco, 32 bytes, guardado como hash), `partSize = 20 MiB`, `expiresAt = now + 24h`.
4. **Fatias**: para `partNumber = 1..N`, `PUT upload/part` com `request.body` embrulhado em `FixedLengthStream(contentLength)` e enviado a `mpu.uploadPart(n, stream)`. O etag volta e é persistido em `kv` (`mpu:<uploadId>`).
   - 3 tentativas automáticas por fatia (backoff 1s, 3s, 7s). Se todas falharem: estado `error` com botão **"Tentar de novo"**, que retoma do primeiro etag ausente.
5. **`POST upload/complete`**: `resumeMultipartUpload(storageKey, r2UploadId)`, `complete(parts ordenadas por partNumber)`, confere `head(storageKey).size === size`, marca `ready`, grava `completedAt`, devolve resumo.
6. **UI de sucesso**: "Arquivo recebido com sucesso." + nome, tamanho e data; botão "Enviar outro arquivo" (pede a senha de novo).

### 5.2 Retomada (24h)

- O cliente guarda em `localStorage` (chave `receber-arquivos:<fingerprint>`): `{ uploadId, token, expiresAt, filename, size }`.
- Ao recarregar a página e selecionar o **mesmo** arquivo (mesmo fingerprint), o cliente chama `upload/status`; se o registro estiver `pending` e o token válido, mostra "Continuar envio (X%)" e retoma das fatias faltantes.
- Expirou (>24h) ou token inválido → descarta a entrada e começa do zero.
- Um `abort` explícito (`upload/abort` ou botão "Cancelar") chama `mpu.abort()` e apaga o registro `pending`.
- Rotina preguiçosa: ao abrir `/uploads`, o plugin pode limpar registros `pending` com `expiresAt` vencido (abort no R2 + delete do registro), no máximo 10 por visita.

### 5.3 Números

- Fatia: **20 MiB** (mínimo do R2 é 5 MiB; 5 GiB / 20 MiB = 256 partes, bem abaixo do teto de 10.000).
- Uma parte por requisição, sequencial. Sem paralelismo (decisão: um arquivo por vez).
- Limite de corpo do Workers Free (100 MB) fica com folga de 5×.

### 5.4 Cliente (browser)

- `File.slice()` + `fetch` por fatia, sem dependências.
- Progresso: porcentagem, MB enviados/total, velocidade média, tempo restante estimado. `aria-live="polite"`.
- Aviso visível: "Mantenha esta aba aberta até o envio terminar." Se a aba for para segundo plano, a UI mostra o mesmo aviso ao voltar.
- `AbortController` para cancelar.
- Sem JS: mensagem `noscript` explicando que o envio precisa de JavaScript (não há fallback possível para 5 GB).

---

## 6. Modelo de dados

Coleção de plugin `uploads` (uma linha por envio):

| Campo | Tipo | Observação |
| --- | --- | --- |
| `id` | string (ULID) | id interno do registro |
| `storageKey` | string | `uploads/<ano>/<ulid>-<nome-sanitizado>.<ext>` (único) |
| `r2UploadId` | string | handle do multipart para retomar/abortar |
| `filename` | string | nome original (para exibir e para `Content-Disposition`) |
| `contentType` | string | tipo declarado pelo browser; fallback `application/octet-stream` |
| `size` | number | bytes declarados no start (conferidos no complete) |
| `status` | `pending` \| `ready` \| `failed` | |
| `createdAt` | ISO string | |
| `completedAt` | ISO \| null | |
| `expiresAt` | ISO string | now + 24h; usado na retomada e na limpeza |
| `tokenHash` | string | SHA-256 do token do upload |
| `ip` | string \| null | de `requestMeta.ip` |
| `userAgent` | string \| null | de `requestMeta.userAgent` |

Índices: `status`, `createdAt`, `["status", "createdAt"]`; único em `storageKey`.

Partes: `ctx.kv` em `mpu:<uploadId>` → `{ parts: Array<{ partNumber, etag, size }> }`. Escrita sequencial (uma parte por vez), com `getVersioned`/`compareAndSet` para não perder etag em retry concorrente.

Configurações (`admin.settingsSchema`):

| Chave | Tipo | Padrão | Uso |
| --- | --- | --- | --- |
| `password` | `secret` | — | senha única de envio |
| `maxFileSizeGb` | `number` (1–10) | `5` | limite por arquivo |
| `quotaGb` | `number` (1–10) | `8` | trava de cota |

> **Pré-requisito de deploy:** campos `secret` usam envelope AES-GCM e dependem de `EMDASH_ENCRYPTION_KEY`. Confirmar que a variável existe em produção **antes** de salvar a senha; sem ela o segredo falha fechado e o envio fica impossível.

---

## 7. Segurança

### 7.1 Senha

- Guardada em `ctx.settings` como campo `secret` (criptografado pelo host).
- Comparação em tempo constante (`secureCompare` sobre SHA-256 de ambos os lados) — nunca `===`.
- Senha ausente nas configurações → página responde "Envios fechados" (não 500) e o admin mostra aviso para configurar.

### 7.2 Atraso progressivo

- Chave `rate:<ip>` no `ctx.kv`: `{ failures, lastAttemptAt }`.
- Falha: `failures++`; atraso antes de responder = `min(300ms × failures, 5000ms)`.
- Sucesso: zera `failures`.
- Janela de 15 min; sem bloqueio rígido (decisão do usuário).
- Resposta de erro é sempre genérica ("Senha incorreta"), sem indicar se a senha existe.
- IP nulo (ex.: proxy sem header confiável) → usa `unknown` e não acumula entre visitantes.

### 7.3 Token do upload

- Token opaco de 32 bytes (`crypto.getRandomValues`), devolvido só no `start`.
- Guardado como SHA-256 em `tokenHash`; comparação em tempo constante.
- Escopo: **um** upload; validade 24h; autoriza `status`, `part`, `complete`, `abort` daquele `uploadId`.

### 7.4 Cota

- `usedBytes` = soma de `size` de registros `pending` e `ready` (paginando a consulta de 100 em 100).
- `start` recusa (`UPLOAD_CLOSED`) quando `usedBytes + size > quotaGb` (8 GiB padrão), mesmo que o arquivo caiba no limite individual.
- `admin/stats` expõe `usedBytes/quotaBytes` para a barra do painel.
- Consequência aceita: com exclusão **manual** e trava em 8 GiB, os envios ficam fechados até o dono excluir. A página mostra "Envios temporariamente fechados" e o painel mostra a barra em vermelho — é o comportamento desejado como freio da cota gratuita.

### 7.5 Acesso aos arquivos

- Nada é público: o bucket não é exposto por `publicUrl`; não há URL de arquivo adivinhável usada na página.
- Download só em `GET /api/receber-arquivos/<id>`:
  - exige `Astro.locals.user`;
  - exige `user.role >= 50` (`ADMIN`; escala: 10 subscriber, 20 contributor, 30 author, 40 editor, 50 admin);
  - `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow, noarchive`;
  - suporta `Range` (retomada de download grande), com `Accept-Ranges: bytes`;
  - `Content-Disposition: attachment; filename*=UTF-8''<nome>`.
- Esse endpoint fica em `src/pages/api/` porque rota raw de plugin bufferiza (restrição 6).

### 7.6 Upload público (abuso)

- Rotas públicas não exigem sessão; toda escrita passa pela senha/token.
- `start` limita tamanho, cota e duplicata; `part` valida `uploadId` + token + `partNumber` no intervalo 1..N.
- Nenhum dado do cliente é aceito como caminho de arquivo: o `storageKey` é gerado no servidor (ULID + nome sanitizado).
- Sanitização do nome: normalizar acentos, remover `/\:*?"<>|` e caracteres de controle, colapsar espaços em `-`, truncar em 80 chars, preservar a extensão original (minúscula).

---

## 8. Comportamento do plugin

### 8.1 Ativação / desativação

- Ativar/desativar em **Admin > Plugins** (estado em `_plugin_state`; sem toggle próprio).
- Desativado: `getPluginRouteMeta` devolve `null` → todas as rotas do plugin respondem 404 (comportamento do host).
- `GET /uploads` precisa responder **404 de verdade** (não 200 com aviso). Implementação: a página faz um `fetch` server-side para `status`; se vier 404, retorna `new Response(null, { status: 404 })` renderizando o 404 do site. Custo: uma requisição interna por visita — aceitável e documentado no código.
- Ao desativar, uploads `pending` ficam órfãos no R2 até a limpeza preguiçosa rodar na próxima ativação.

### 8.2 Hook de ativação

- `plugin:activate`: garante que a coleção `uploads` está declarada (o host cria) e registra log informativo.
- Sem cron: a limpeza de `pending` vencidos é preguiçosa (ver 5.2), para não gastar invocações no plano gratuito.

---

## 9. Página pública `/uploads`

### 9.1 Estrutura

- Sem navbar/menu do site (evita o cliente se perder), mas com a **identidade visual**: fundo escuro, `font-display` Playfair no título, DM Sans no corpo, detalhes dourados (`--primary`), o mesmo `coord-text` usado nas seções.
- Conteúdo:
  - eyebrow: `/ ENVIO DE ARQUIVOS`
  - título: "Envie seu material"
  - subtítulo curto: "Digite a senha e escolha o arquivo. Você pode fechar a página depois da confirmação."
  - campo de senha (`type="password"`, `autocomplete="current-password"`, `enterkeyhint="next"`)
  - seletor de arquivo (drag-and-drop opcional, com fallback de clique)
  - resumo do arquivo selecionado (nome, tamanho legível)
  - botão "Enviar"
  - área de progresso (barra + % + MB/s + tempo restante + "Cancelar")
  - área de erro (`role="alert"`) e área de sucesso (`role="status"`)
- Estado de sucesso: "Arquivo recebido com sucesso." + resumo (nome, tamanho, data) + botão "Enviar outro arquivo" (limpa senha e volta ao início).
- Estado de cota: "Envios temporariamente fechados. Fale com o responsável." (sem detalhes técnicos).
- Rodapé mínimo: e-mail/Instagram do site (reaproveita settings), sem link para outras páginas internas? **Não**: nenhum link para a vitrine (evita rastreio e dispersão).

### 9.2 Responsivo e mobile

- Uma coluna, `max-width` ~640px, toque: alvos ≥ 44px.
- `font-size: 16px` nos inputs (evita zoom no iOS).
- Aviso explícito para não bloquear a tela do celular.
- `viewport-fit=cover` já vem do layout? A página usa `<html>` próprio e replica as meta tags essenciais do `Base.astro` (viewport, charset, theme-color) sem o restante do layout.

### 9.3 Acessibilidade

- Labels associados, `aria-live` no progresso e no resultado, foco visível, contraste AA no texto secundário.
- `prefers-reduced-motion`: sem animações de barrinha/entrada.

---

## 10. Noindex / SEO

Todas as camadas, porque "não pode ser indexado" foi pedido explicitamente:

1. **Meta na página**: `<meta name="robots" content="noindex, nofollow, noarchive">`.
2. **Header**: `Astro.response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive")` na página e no download.
3. **`public/robots.txt`** (novo arquivo):
   ```
   User-agent: *
   Allow: /
   Disallow: /uploads
   Disallow: /api/receber-arquivos/
   ```
   Confirmar que o site não tinha `robots.txt` antes (não tinha; `public/` só tem a pasta `uploads` vazia).
4. **Sem links**: nenhum item de menu, nenhum link na home, nenhum `sitemap` referencia `/uploads`.
5. **Arquivos**: nunca servidos por caminho público; o único acesso é a rota autenticada, que também envia `X-Robots-Tag`.
6. Verificação nos testes: `meta[name=robots]`, header e `robots.txt`.

---

## 11. Painel "Receber arquivos"

- Rota admin: `/_emdash/admin/plugins/receber-arquivos/` (page `/`, label "Receber arquivos", ícone inbox).
- Implementação: `admin.tsx` exporta `pages = { "/": <AdminPage /> }` (React + HTML/Tailwind simples, **sem** kumo/phosphor).
- Conteúdo:
  - barra de cota: `usados / 8 GiB` com aviso quando > 80%;
  - tabela: arquivo (nome + tipo), tamanho, status, enviado em, IP, navegador resumido;
  - ações por linha: **Baixar** (link para `/api/receber-arquivos/<id>`) e **Excluir** (confirmação);
  - estado vazio: "Nenhum arquivo recebido ainda.";
  - paginação de 50 em 50 (`admin/list`).
- Dados via `fetch` para `/_emdash/api/plugins/receber-arquivos/admin/*` com header `X-EmDash-Request: 1` (CSRF do host).
- Excluir: apaga o objeto do R2 (`env.MEDIA.delete(storageKey)`) e o registro; se o delete do R2 falhar, mantém o registro com erro visível (nunca "finge" que apagou).
- Aviso fixo no topo: "Os arquivos ocupam a cota gratuita do R2 (10 GB). Exclua depois de baixar."

---

## 12. Configuração e operação

- Nenhum segredo novo no Worker (sem token S3, sem CORS de bucket, sem `RESEND_API_KEY`).
- `pnpm install` após adicionar o pacote de workspace (atualiza `pnpm-lock.yaml`).
- Deploy normal (`pnpm run deploy:prod`); nada muda em `wrangler.jsonc`.
- Cota e senha mudam pelo admin, sem deploy.
- Checklist de go-live:
  1. `EMDASH_ENCRYPTION_KEY` presente em produção;
  2. plugin ativo em Admin > Plugins;
  3. senha salva nas configurações;
  4. `/uploads` responde 200 e `X-Robots-Tag`;
  5. `robots.txt` responde com `Disallow`;
  6. envio de um arquivo pequeno de teste cai no painel;
  7. download autenticado funciona.

---

## 13. Testes

`tests/receber-arquivos.spec.ts` (Playwright, **sem baseline visual**):

1. `GET /uploads` → 200, contém `meta[name=robots][content*=noindex]` e header `X-Robots-Tag`.
2. `GET /robots.txt` → contém `Disallow: /uploads`.
3. Senha errada → mensagem "Senha incorreta", nenhuma linha criada (verificar via API admin autenticada ou `admin/list`).
4. Envio feliz com arquivo sintético pequeno (ex.: 6 MB gerado em memória) → mensagem de sucesso com nome/tamanho; registro aparece em `admin/list`.
5. Envio de arquivo acima do limite (simular com `size` declarado) → erro claro de tamanho.
6. `GET /api/receber-arquivos/<id>` sem sessão → 401/403; com sessão dev bypass → 200 `application/octet-stream`.
7. Plugin desativado → `/uploads` 404. (Se desativar via API no teste for instável, marcar como `test.fixme` com nota no `docs/BACKLOG.md`.)

Notas de execução: o dev server precisa estar de pé (runbook em `docs/qa/README.md`); o login do admin usa `/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`. Não gerar screenshot.

Teste manual obrigatório (não automatizável no CI): **um envio real de ~5 GB** para medir CPU/erros do plano gratuito e confirmar retomada após recarregar a página.

---

## 14. Riscos e pontos de atenção

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| CPU de 10 ms no Workers Free durante streaming | erros 1102/413 em produção | fatias de 20 MB sem hash no Worker; medir com 5 GB real; se falhar, cair para 10 MB ou reavaliar presigned direto |
| Cota R2 Free de 10 GB + exclusão manual | envios fecham ao passar de 8 GiB | trava de cota visível no painel; aviso para excluir após baixar |
| Retomada depende de `localStorage` | trocar de navegador/aparelho recomeça | aceito; aviso na UI |
| Aba em segundo plano no celular | progresso estagna | aviso "mantenha a aba aberta"; retry + retomada |
| Plugin nativo local via workspace | build/deploy pode exigir ajuste | caminho alternativo com entrypoint absoluto documentado em 4.3 |
| `EMDASH_ENCRYPTION_KEY` ausente | segredo da senha ilegível | checar antes do go-live (12) |
| Sem registro na Biblioteca de Mídia | vídeos não aparecem em Admin > Mídia | decisão explícita; documentar no README do plugin |

---

## 15. Critérios de aceite

- [ ] `/uploads` carrega com identidade do site e pede senha; senha errada não cria registro.
- [ ] Arquivo de teste de 6 MB sobe em fatias, completa e aparece no painel do plugin.
- [ ] Arquivo acima de 5 GiB é recusado antes de transferir.
- [ ] Queda de rede no meio → 3 retries automáticos; se falhar, "Tentar de novo" retoma da fatia faltante.
- [ ] Recarregar a página com o mesmo arquivo em <24h mostra "Continuar envio".
- [ ] Cota > 8 GiB bloqueia `start` com "Envios temporariamente fechados".
- [ ] Painel lista, baixa e exclui; exclusão remove objeto do R2.
- [ ] Download só funciona logado como ADMIN.
- [ ] Desativar o plugin faz `/uploads` e as rotas responderem 404.
- [ ] `meta robots`, `X-Robots-Tag` e `robots.txt` presentes; nenhum link para `/uploads` no site.
- [ ] Suite Playwright nova passa; suíte existente segue passando.
- [ ] Nenhum segredo novo, nenhuma dependência de runtime nova no site.

---

## 16. Limpeza pedida (PR separado) — o que a investigação achou

O usuário pediu para confirmar se `public/uploads` é padrão do EmDash e, se não for usado, remover em um PR de limpeza, verificando outros lixos. Resultado:

1. **`public/uploads`**: é uma pasta **vazia** e **não versionada**. O Git não registra diretórios vazios, então **não há nada para remover em PR** — ela existe só nesta máquina. Nenhum código referencia `/uploads/...` (grep em `src/`, `seed/`, `tests/`, `scripts/`, `.github/`). O caminho é livre para a página nova. Ação: `rmdir public/uploads` local, se quiser; nada a commitar.
2. **`uploads/` na raiz** (24 `.webp`, ignorada por `.gitignore:35`): sobra de uma configuração antiga de `local({ directory: "./uploads" })` (documentada só nas skills). O banco local `data.db` tem `media` com **0 linhas**, então nada referencia esses arquivos. Não é lixo de repositório; pode ser apagado localmente sem afetar build/deploy.
3. **`emdash-env.d.ts` está versionado embora esteja no `.gitignore`** (linha 39). É uma inconsistência real: ou se destrackeia e se garante a geração no CI, ou se remove a linha do ignore. Decidir no PR de limpeza, com cuidado para não quebrar `astro check` em CI.
4. **`.claude/skills`** é um symlink versionado para `../.agents/skills` — intencional, manter.
5. **`scratch/`, `dist/`, `.wrangler/`, `playwright-report/`, `test-results/`, `data.db`**: todos ignorados e não versionados — nada a fazer.

**Conclusão do PR de limpeza:** não há lixo versionado a remover além da decisão sobre `emdash-env.d.ts`. Recomenda-se um PR pequeno só para isso, separado da feature, como pedido — sem bloquear a implementação.

---

## 17. Arquivos que serão criados/alterados

| Arquivo | Ação |
| --- | --- |
| `pnpm-workspace.yaml` | adicionar `plugins/*` em `packages` |
| `plugins/receber-arquivos/package.json` | novo (pacote de workspace) |
| `plugins/receber-arquivos/src/*` | novo (plugin: rotas, storage, senha, R2, admin) |
| `astro.config.mjs` | registrar `receberArquivosPlugin()` |
| `src/pages/uploads.astro` | novo (página pública, noindex, 404 quando desativado) |
| `src/components/receber-arquivos/*` | novo (UI + cliente de upload) |
| `src/pages/api/receber-arquivos/[id].ts` | novo (download autenticado com Range) |
| `public/robots.txt` | novo (disallow) |
| `tests/receber-arquivos.spec.ts` | novo (E2E) |
| `docs/qa/README.md` | linha na tabela de cobertura |
| `docs/BACKLOG.md` | achados fora de escopo, se houver |

Nenhuma migração de banco escrita à mão: a coleção vem do `storage` declarado no plugin e o host cria as tabelas de plugin.

# Sincronizar Ambiente Local (pull) e Schema de Produção (push)

Para garantir que o seu ambiente de desenvolvimento local seja um clone idêntico da produção — e para levar a evolução do schema local de volta — foi criada uma ferramenta CLI automatizada.

Os comandos são **explícitos** e rodam em **dry-run por padrão**: sem `--apply` nada é alterado — o CLI só imprime o plano. Rodar `npm run sync` sem comando mostra a ajuda.

### Puxar a produção para o local (pull)

Basta executar o seguinte comando na raiz do projeto:

```bash
npm run sync -- pull --apply
```

Para ver o plano sem tocar em nada (o dry-run é o padrão):

```bash
npm run sync -- pull
```

**O que o `pull --apply` fará:**

1. Desligará qualquer servidor local do Astro em execução na porta `4321` para destravar os arquivos (`EBUSY`).
2. Salvará uma **cópia de rollback** de `.wrangler/state/v3/{d1,r2}` em `.wrangler/backups/<timestamp>/` (mantendo os 3 últimos). Esse backup serve **apenas para rollback** — é o estado local anterior, guardado para poder voltar atrás.
3. Limpará o banco e o storage locais do emulador do Cloudflare (`.wrangler/state/v3/d1` e `.wrangler/state/v3/r2`).
4. Descobrirá as tabelas do banco remoto automaticamente (com retry antes do fallback) e fará o download/injeção do D1 (`wrangler d1 export/execute`), ignorando tabelas internas e o índice de busca (FTS).
5. Fará o download em lotes paralelos e a gravação de todas as mídias do bucket R2 no disco da sua máquina (`wrangler r2 object put --local`).
6. Exibirá um resumo das mídias (no banco x baixadas x falhas) e limpará os arquivos de dump e de buffer antes de encerrar.

Após o script finalizar (quando exibir a mensagem "🎉 Sync 100% complete! Local environment is identical to production."), você pode iniciar o servidor normalmente:

```bash
npm run dev
```

Seu ambiente local agora usa **exclusivamente os emuladores do Wrangler** idênticos à produção.

### Enviar o schema local para a produção (push)

O `push` leva **somente o schema** (collections, campos, block types e taxonomias) do banco local para a produção — **nunca conteúdo**: termos, menus, widgets e settings ficam de fora.

```bash
npm run sync -- push          # dry-run: mostra os passos do schema
npm run sync -- push --apply  # aplica o schema na produção
```

- Por padrão o schema é **gerado do banco local** (a fonte de verdade é o seu D1 local); `--seed=<arquivo>` usa um seed específico (ex.: um snapshot congelado).
- O alvo é resolvido nesta ordem: `--url` → `EMDASH_URL` → `SITE_URL` (ambiente ou `.env`/`.env.local`) → domínio do Worker na Cloudflare → sessão do EmDash.
- Mudança nos **campos de um block type existente** é recusada (quebraria o conteúdo renderizado): o plano avisa e pede uma versão nova criada no admin.

### Detalhes deste projeto

- **D1**: banco `perspectivadrone` (binding `DB`), definido em `wrangler.jsonc`.
- **R2**: bucket `perspectivadrone` (binding `MEDIA`).
- O CLI é o pacote compartilhado [`Sena/emdash-sync-cli`](https://github.com/Sena/emdash-sync-cli), referenciado via `npx` (mesmo usado no projeto `minicommerce`).

### Observações

- **Destrutivo no local**: o `pull --apply` substitui o conteúdo e as mídias locais pelos de produção. A cópia de rollback fica em `.wrangler/backups/` (que está no `.gitignore`) e serve **apenas para voltar atrás** — não é backup permanente: para desfazer um sync, pare o servidor e copie `.wrangler/backups/<timestamp>/{d1,r2}` de volta para `.wrangler/state/v3/`.
- Para pular o backup: `npm run sync -- pull --no-backup --apply`.
- **Busca**: as tabelas de índice FTS não são exportadas; o EmDash reconstrói o índice automaticamente no primeiro acesso à busca no ambiente local.
- **Autenticação**: duas credenciais podem entrar em jogo — a do **Cloudflare/wrangler** (usada pelo `pull` e pela descoberta do alvo) e a **sessão de admin do EmDash** (usada pelo `push`). Se faltar login, o próprio erro traz o comando exato do conserto; em terminal interativo o CLI abre o login sozinho e repete o comando (para desligar: `EMDASH_SYNC_AUTO_LOGIN=0`). Consertos manuais: `npx wrangler login` (se for conta errada, `npx wrangler logout` antes) ou `npx emdash login --url <url>`.

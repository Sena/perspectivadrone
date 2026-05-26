# Sincronizar Banco e Mídias de Produção para Local

Para garantir que o seu ambiente de desenvolvimento local seja um clone idêntico da produção, foi criada uma ferramenta CLI automatizada.

O comando abaixo apaga todo o conteúdo antigo armazenado localmente, faz o download read-only de todas as tabelas oficiais do Cloudflare D1 de produção, descobre automaticamente a URL do site e baixa todas as imagens físicas direto para o emulador do Cloudflare R2 local.

### Como Sincronizar

Basta executar o seguinte comando na raiz do projeto:

```bash
npm run sync
```

**O que o script fará:**
1. Desligará qualquer servidor local do Astro em execução na porta `4321` para destravar os arquivos (`EBUSY`).
2. Limpará as pastas ocultas do emulador do Cloudflare (`.wrangler/state/v3/*`).
3. Fará o download e a injeção do banco de dados D1 (`wrangler d1 export/execute`).
4. Fará o download veloz, processamento em lotes paralelos (chunks) e gravação de todas as imagens do bucket R2 no disco da sua máquina (`wrangler r2 object put`).
5. Limpará os arquivos de dump e de buffer antes de encerrar.

Após o script finalizar (quando exibir a mensagem "🎉 Sincronização 100% concluída"), você pode iniciar o servidor normalmente:

```bash
npm run dev
```

Seu ambiente local agora usa **exclusivamente os emuladores do Wrangler** idênticos à produção.

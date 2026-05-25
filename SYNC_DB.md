# Sincronizar Banco de Produção (D1) para Local

Siga os passos abaixo para baixar os dados de produção para o seu ambiente local de desenvolvimento. Como o Cloudflare D1 possui uma limitação ao exportar bancos inteiros que contêm tabelas virtuais (FTS5 - usadas pelo EmDash para buscas), precisamos exportar apenas as tabelas físicas.

### 1. Exportar Tabelas de Produção

Execute o script Node.js abaixo para gerar o arquivo de dump (`tabela.sql`) contendo apenas as tabelas válidas:

```bash
node -e "const tables = ['_emdash_migrations', 'revisions', 'media', 'options', 'audit_logs', '_emdash_collections', '_emdash_fields', '_plugin_storage', '_plugin_state', '_plugin_indexes', '_emdash_widget_areas', '_emdash_widgets', 'users', 'credentials', 'auth_tokens', 'oauth_accounts', 'allowed_domains', 'auth_challenges', '_emdash_sections', '_emdash_api_tokens', '_emdash_oauth_tokens', '_emdash_device_codes', '_emdash_authorization_codes', '_emdash_seo', '_emdash_oauth_clients', '_emdash_cron_tasks', '_emdash_comments', '_emdash_redirects', '_emdash_404_log', '_emdash_bylines', '_emdash_content_bylines', '_emdash_rate_limits', 'ec_posts', 'ec_pages', 'ec_portfolio', 'ec_services', 'content_taxonomies', '_emdash_menu_items', '_emdash_menus', 'taxonomies', '_emdash_taxonomy_defs']; const args = tables.map(t => '--table=' + t).join(' '); const { execSync } = require('child_process'); console.log('Exportando tabelas do D1...'); execSync('npx wrangler d1 export perspectivadrone --remote ' + args + ' --output=tabela.sql', { stdio: 'inherit' });"
```

### 2. Limpar o Banco Local

Para evitar erros de conflito (`UNIQUE constraint failed`), apague a base local atual que fica armazenada pela simulação do Wrangler (feche o servidor de dev primeiro, se estiver rodando):

- **PowerShell (Windows)**:
  ```bash
  Remove-Item .wrangler\state\v3\d1\* -Recurse -Force -ErrorAction SilentlyContinue
  ```
- **Bash (Mac/Linux)**:
  ```bash
  rm -rf .wrangler/state/v3/d1/*
  ```

### 3. Importar para a Base Local

Execute o dump baixado no seu banco de dados D1 local:

```bash
npx wrangler d1 execute perspectivadrone --local --file=tabela.sql
```

Pronto! Agora você pode rodar o seu ambiente local (`pnpm run dev`) e ele estará refletindo os dados e mídias cadastrados no ambiente de produção.

# Receber arquivos (`receber-arquivos`)

Plugin nativo do EmDash que abre o link `/uploads` para o cliente enviar
arquivos grandes — vídeos de 5 GB inclusive. Os arquivos vão para o bucket R2
`MEDIA` em `uploads/<ano>/` e aparecem no painel do plugin, onde o administrador
baixa ou exclui.

## Modelo de acesso: ativar e desativar

Não há senha. O gate é o **ativar/desativar o plugin** em Admin → Plugins:

- **Ativo** — qualquer pessoa com o link `/uploads` pode enviar.
- **Desativado** — página e todas as rotas do plugin respondem **404**.

Fluxo de uso: ative, mande o link para o cliente, espere o envio aparecer no
painel e **desative** em seguida.

## Como funciona

- `POST upload/start` valida tamanho, cota e duplicata; cria o registro
  `pending` e o multipart no R2.
- `PUT upload/part?uploadId&partNumber&token` recebe **5 MiB por requisição** e
  chama `uploadPart` no R2. O host do EmDash lê o corpo da rota antes do handler
  e limita a 8 MiB (`PLUGIN_ROUTE_MAX_BODY_BYTES`), então streaming cru pelo
  plugin não é possível — 5 MiB é o mínimo de parte do R2 e mantém 1.024 partes
  para 5 GiB (teto do R2: 10.000).
- `POST upload/complete` fecha o multipart, confere o tamanho no `head()` e
  marca o registro como `ready`.
- Download e exclusão passam por rotas privadas (`plugins:read` e
  `plugins:manage`); o download em si é servido por
  `src/pages/api/receber-arquivos/[id].ts` porque resposta raw de rota de plugin
  é bufferizada em 8 MiB.

## Configuração

Em **Admin → Plugins → Receber arquivos → Configurações**:

| Chave | Padrão | Uso |
| --- | --- | --- |
| `maxFileSizeGb` | 5 | limite por arquivo |
| `quotaGb` | 8 | trava de cota (novos envios bloqueados) |

Nenhum campo `secret`: o plugin não depende de `EMDASH_ENCRYPTION_KEY`.

## Operação

- Uploads `pending` vencidos (24h) são limpos na próxima visita a `/uploads`,
  no máximo 5 por vez.
- Nada é indexável: meta `robots`, `X-Robots-Tag`, `robots.txt` e nenhum link
  para `/uploads` no site.
- Os arquivos **não** entram na Biblioteca de Mídia do EmDash — o EmDash não
  expõe API para registrar um objeto já existente do R2 como mídia. O painel
  deste plugin é o acervo desses envios.

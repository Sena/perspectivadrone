/**
 * Constantes e contratos compartilhados entre o descritor (carregado pelo
 * `astro.config.mjs` em Node) e o runtime do plugin (Worker).
 *
 * Este arquivo NÃO pode importar `cloudflare:workers` nem nada de runtime:
 * o `astro.config.mjs` importa o descritor, e o config roda em Node puro.
 */

export const PLUGIN_ID = "receber-arquivos";
export const PLUGIN_VERSION = "0.1.0";
export const PLUGIN_ENTRYPOINT = "@perspectiva/receber-arquivos";
export const PLUGIN_ADMIN_ENTRY = "@perspectiva/receber-arquivos/admin";

export const API_BASE = `/_emdash/api/plugins/${PLUGIN_ID}`;

/**
 * Tamanho da fatia enviada por requisição.
 *
 * O host do EmDash lê o corpo da rota ANTES de chamar o handler
 * (`parseRouteInput` em `node_modules/emdash/src/plugins/routes.ts`) e o teto
 * declarável é `PLUGIN_ROUTE_MAX_BODY_BYTES` = 8 MiB. 5 MiB é o mínimo de
 * parte do R2 multipart, então cabe com folga e mantém 5 GiB / 5 MiB = 1024
 * partes (teto do R2: 10.000).
 */
export const PART_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_PARTS = 10_000;

export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const GIB = 1024 ** 3;

export const DEFAULT_MAX_FILE_GB = 5;
export const DEFAULT_QUOTA_GB = 8;

/** Papel mínimo para baixar/administrar arquivos (ADMIN na escala do EmDash). */
export const ADMIN_ROLE = 50;

export type UploadStatus = "pending" | "ready" | "failed";

export interface UploadRecord {
  /** ULID-like: ordenável por prefixo de tempo. */
  id: string;
  storageKey: string;
  r2UploadId: string;
  filename: string;
  contentType: string;
  size: number;
  status: UploadStatus;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
  tokenHash: string;
  ip: string | null;
  userAgent: string | null;
}

export interface StoredPart {
  partNumber: number;
  etag: string;
  size: number;
}

import {
  buildStorageKey,
  constantTimeEqual,
  newRecordId,
  randomToken,
  sanitizeFilename,
  sha256Hex,
} from "./crypto.js";
import { getMediaBucket } from "./r2.js";
import {
  DEFAULT_MAX_FILE_GB,
  DEFAULT_QUOTA_GB,
  GIB,
  MAX_PARTS,
  PART_SIZE_BYTES,
  UPLOAD_TTL_MS,
  type StoredPart,
  type UploadRecord,
} from "./shared.js";
import type { PluginRouteContext, StoredParts, UploadsCollection } from "./types.js";

// =============================================================================
// Helpers
// =============================================================================

function uploads(ctx: PluginRouteContext): UploadsCollection {
  return (ctx.storage as { uploads: UploadsCollection }).uploads;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function settingsNumber(ctx: PluginRouteContext, key: string, fallback: number): Promise<number> {
  try {
    const value = await ctx.settings.get<number>(key);
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  } catch {
    // Segredo/setting ilegível: cai no padrão.
  }
  return fallback;
}

async function sumStoredBytes(ctx: PluginRouteContext): Promise<number> {
  let cursor: string | undefined;
  let total = 0;
  // Cota é calculada paginando (máx. 100 por página). O teto é 10 GB / 5 MiB,
  // então o laço termina bem antes do limite de segurança abaixo.
  for (let page = 0; page < 100; page++) {
    const result = await uploads(ctx).query({
      where: { status: { in: ["pending", "ready"] } },
      limit: 100,
      cursor,
    });
    for (const item of result.items) {
      const size = Number(item.data.size);
      if (Number.isFinite(size) && size > 0) total += size;
    }
    if (!result.hasMore || !result.cursor) break;
    cursor = result.cursor;
  }
  return total;
}

type AuthResult = { ok: true; record: UploadRecord } | { ok: false; error: string };

async function authorizeUpload(
  ctx: PluginRouteContext,
  uploadId: string,
  token: string,
): Promise<AuthResult> {
  if (!uploadId || !token) return { ok: false, error: "INVALID_TOKEN" };
  const record = await uploads(ctx).get(uploadId);
  if (!record) return { ok: false, error: "INVALID_TOKEN" };
  const hash = await sha256Hex(token);
  if (!constantTimeEqual(hash, record.tokenHash)) return { ok: false, error: "INVALID_TOKEN" };
  if (record.status !== "pending") return { ok: false, error: "INVALID_STATE" };
  if (Date.parse(record.expiresAt) < Date.now()) return { ok: false, error: "EXPIRED" };
  return { ok: true, record };
}

async function readStoredParts(ctx: PluginRouteContext, uploadId: string): Promise<StoredPart[]> {
  const stored = await ctx.kv.get<StoredParts>(`mpu:${uploadId}`);
  return Array.isArray(stored?.parts) ? stored.parts : [];
}

async function savePart(ctx: PluginRouteContext, uploadId: string, part: StoredPart): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await ctx.kv.getVersioned<StoredParts>(`mpu:${uploadId}`);
    const parts = (current?.value?.parts ?? []).filter((item) => item.partNumber !== part.partNumber);
    parts.push(part);
    parts.sort((a, b) => a.partNumber - b.partNumber);
    const result = await ctx.kv.compareAndSet(
      `mpu:${uploadId}`,
      current?.revision ?? null,
      { parts } satisfies StoredParts,
    );
    if (result.applied) return;
  }
  throw new Error("Falha ao registrar a parte do upload");
}

const CLEANUP_KEY = "cleanup:lastRun";

/** Limpeza preguiçosa de uploads `pending` vencidos (máx. 5 por execução). */
async function cleanupExpired(ctx: PluginRouteContext): Promise<void> {
  const now = Date.now();
  const last = await ctx.kv.get<number>(CLEANUP_KEY).catch(() => null);
  if (typeof last === "number" && now - last < 10 * 60 * 1000) return;
  await ctx.kv.set(CLEANUP_KEY, now).catch(() => undefined);

  const page = await uploads(ctx).query({
    where: { status: "pending", expiresAt: { lt: new Date(now).toISOString() } },
    limit: 5,
  });
  for (const item of page.items) {
    try {
      const bucket = getMediaBucket();
      await bucket.resumeMultipartUpload(item.data.storageKey, item.data.r2UploadId).abort();
    } catch {
      // Multipart já não existe: o registro ainda precisa sair.
    }
    await uploads(ctx)
      .delete(item.id)
      .catch(() => false);
    await ctx.kv.delete(`mpu:${item.id}`).catch(() => false);
  }
}

function toAdminItem(id: string, record: UploadRecord) {
  return {
    id,
    filename: record.filename,
    size: record.size,
    contentType: record.contentType,
    status: record.status,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    expiresAt: record.expiresAt,
    ip: record.ip,
    userAgent: record.userAgent,
  };
}

// =============================================================================
// Rotas públicas
// =============================================================================

const START_WINDOW_MS = 10 * 60 * 1000;
const MAX_STARTS_PER_WINDOW = 10;
const startHitsByIp = new Map<string, number[]>();

function isStartRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (startHitsByIp.get(ip) ?? []).filter((at) => now - at < START_WINDOW_MS);
  if (recent.length >= MAX_STARTS_PER_WINDOW) {
    startHitsByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  startHitsByIp.set(ip, recent);
  if (startHitsByIp.size > 2_000) {
    for (const [key, hits] of startHitsByIp) {
      if (hits.every((at) => now - at >= START_WINDOW_MS)) startHitsByIp.delete(key);
    }
  }
  return false;
}

export async function handleStatus(ctx: PluginRouteContext) {
  const [usedBytes, maxFileSizeGb, quotaGb, activeVal] = await Promise.all([
    sumStoredBytes(ctx).catch(() => 0),
    settingsNumber(ctx, "maxFileSizeGb", DEFAULT_MAX_FILE_GB),
    settingsNumber(ctx, "quotaGb", DEFAULT_QUOTA_GB),
    ctx.kv.get<boolean>("active").catch(() => null),
  ]);
  await cleanupExpired(ctx).catch(() => undefined);

  const active = activeVal !== false;
  const quotaBytes = Math.round(quotaGb * GIB);
  return {
    ok: true,
    active,
    maxFileSize: Math.round(maxFileSizeGb * GIB),
    quotaBytes,
    usedBytes,
    closed: !active || usedBytes >= quotaBytes,
  };
}

export async function handleStart(ctx: PluginRouteContext) {
  // 1) Checagem de ativação do plugin
  const activeVal = await ctx.kv.get<boolean>("active").catch(() => null);
  if (activeVal === false) return { ok: false, error: "UPLOAD_CLOSED" };

  // 2) Checagem de origem (same-origin)
  const origin = ctx.request.headers.get("origin");
  const url = new URL(ctx.request.url);
  if (origin !== null && origin !== url.origin) {
    return { ok: false, error: "UNAUTHORIZED_ORIGIN" };
  }
  if (ctx.request.headers.get("sec-fetch-site") === "cross-site") {
    return { ok: false, error: "UNAUTHORIZED_ORIGIN" };
  }

  // 3) Trava de volume por IP
  const ip = ctx.requestMeta.ip ?? "desconhecido";
  if (isStartRateLimited(ip)) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  const body = asRecord(ctx.input);
  const filenameRaw = typeof body.filename === "string" ? body.filename : "";
  const rawContentType =
    typeof body.contentType === "string" && body.contentType.trim()
      ? body.contentType.trim().slice(0, 200)
      : "application/octet-stream";
  const DANGEROUS_MIMES = [
    "text/html",
    "text/xml",
    "application/xml",
    "application/xhtml+xml",
    "image/svg+xml",
    "text/javascript",
    "application/javascript",
  ];
  const contentType = DANGEROUS_MIMES.includes(rawContentType.toLowerCase().split(";")[0])
    ? "application/octet-stream"
    : rawContentType;
  const size = Number(body.size);
  const confirmDuplicate = body.confirmDuplicate === true;

  if (!Number.isInteger(size) || size <= 0) return { ok: false, error: "FILE_EMPTY" };

  const [maxFileSizeGb, quotaGb] = await Promise.all([
    settingsNumber(ctx, "maxFileSizeGb", DEFAULT_MAX_FILE_GB),
    settingsNumber(ctx, "quotaGb", DEFAULT_QUOTA_GB),
  ]);
  const maxFileSize = Math.round(maxFileSizeGb * GIB);
  if (size > maxFileSize) return { ok: false, error: "FILE_TOO_LARGE" };
  if (Math.ceil(size / PART_SIZE_BYTES) > MAX_PARTS) return { ok: false, error: "FILE_TOO_LARGE" };

  const usedBytes = await sumStoredBytes(ctx);
  const quotaBytes = Math.round(quotaGb * GIB);
  if (usedBytes + size > quotaBytes) return { ok: false, error: "UPLOAD_CLOSED" };

  const filename = sanitizeFilename(filenameRaw || "arquivo");
  if (!confirmDuplicate) {
    const recent = await uploads(ctx).query({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
      limit: 100,
    });
    const duplicate = recent.items.some(
      (item) => item.data.filename === filename && item.data.size === size,
    );
    if (duplicate) return { ok: false, error: "DUPLICATE" };
  }

  let bucket;
  try {
    bucket = getMediaBucket();
  } catch {
    return { ok: false, error: "STORAGE_UNAVAILABLE" };
  }

  const id = newRecordId();
  const storageKey = buildStorageKey(id, filename, new Date().getFullYear());
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS).toISOString();

  let multipart;
  try {
    multipart = await bucket.createMultipartUpload(storageKey, {
      httpMetadata: { contentType },
    });
  } catch (error) {
    ctx.log.error("Falha ao criar multipart no R2", { error: String(error) });
    return { ok: false, error: "STORAGE_UNAVAILABLE" };
  }

  const record: UploadRecord = {
    id,
    storageKey,
    r2UploadId: multipart.uploadId,
    filename,
    contentType,
    size,
    status: "pending",
    createdAt: now.toISOString(),
    completedAt: null,
    expiresAt,
    tokenHash,
    ip: ctx.requestMeta.ip,
    userAgent: ctx.requestMeta.userAgent,
  };

  try {
    await uploads(ctx).put(id, record);
  } catch (error) {
    await multipart.abort().catch(() => undefined);
    ctx.log.error("Falha ao registrar o upload", { error: String(error) });
    return { ok: false, error: "STORAGE_UNAVAILABLE" };
  }

  return {
    ok: true,
    uploadId: id,
    token,
    partSize: PART_SIZE_BYTES,
    totalParts: Math.ceil(size / PART_SIZE_BYTES),
    expiresAt,
    uploadedParts: [],
  };
}

export async function handleUploadStatus(ctx: PluginRouteContext) {
  const url = new URL(ctx.request.url);
  const auth = await authorizeUpload(
    ctx,
    url.searchParams.get("uploadId") ?? "",
    url.searchParams.get("token") ?? "",
  );
  if (!auth.ok) return { ok: false, error: auth.error };

  const parts = await readStoredParts(ctx, auth.record.id);
  return {
    ok: true,
    status: auth.record.status,
    expiresAt: auth.record.expiresAt,
    partSize: PART_SIZE_BYTES,
    totalParts: Math.ceil(auth.record.size / PART_SIZE_BYTES),
    uploadedParts: parts.map((part) => part.partNumber),
    receivedBytes: parts.reduce((total, part) => total + part.size, 0),
  };
}

export async function handlePart(ctx: PluginRouteContext) {
  const url = new URL(ctx.request.url);
  const uploadId = url.searchParams.get("uploadId") ?? "";
  const token = url.searchParams.get("token") ?? "";
  const partNumber = Number(url.searchParams.get("partNumber"));
  const bytes = ctx.input;

  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return { ok: false, error: "INVALID_BODY" };
  }
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    return { ok: false, error: "INVALID_PART" };
  }

  const auth = await authorizeUpload(ctx, uploadId, token);
  if (!auth.ok) return { ok: false, error: auth.error };
  const record = auth.record;

  const totalParts = Math.ceil(record.size / PART_SIZE_BYTES);
  if (partNumber > totalParts) return { ok: false, error: "INVALID_PART" };
  const expectedSize =
    partNumber < totalParts ? PART_SIZE_BYTES : record.size - PART_SIZE_BYTES * (totalParts - 1);
  if (bytes.byteLength !== expectedSize) return { ok: false, error: "INVALID_PART_SIZE" };

  try {
    const bucket = getMediaBucket();
    const multipart = bucket.resumeMultipartUpload(record.storageKey, record.r2UploadId);
    const uploaded = await multipart.uploadPart(partNumber, bytes);
    await savePart(ctx, record.id, {
      partNumber,
      etag: uploaded.etag,
      size: bytes.byteLength,
    });
    return { ok: true, partNumber, etag: uploaded.etag };
  } catch (error) {
    ctx.log.error("Falha ao enviar parte ao R2", { partNumber, error: String(error) });
    return { ok: false, error: "PART_FAILED" };
  }
}

export async function handleComplete(ctx: PluginRouteContext) {
  const body = asRecord(ctx.input);
  const auth = await authorizeUpload(
    ctx,
    typeof body.uploadId === "string" ? body.uploadId : "",
    typeof body.token === "string" ? body.token : "",
  );
  if (!auth.ok) return { ok: false, error: auth.error };
  const record = auth.record;

  const parts = await readStoredParts(ctx, record.id);
  const totalParts = Math.ceil(record.size / PART_SIZE_BYTES);
  if (parts.length !== totalParts) return { ok: false, error: "MISSING_PARTS" };

  const ordered = parts
    .slice()
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((part) => ({ partNumber: part.partNumber, etag: part.etag }));

  try {
    const bucket = getMediaBucket();
    const multipart = bucket.resumeMultipartUpload(record.storageKey, record.r2UploadId);
    await multipart.complete(ordered);

    const head = await bucket.head(record.storageKey);
    if (!head || head.size !== record.size) {
      await bucket.delete(record.storageKey).catch(() => undefined);
      await uploads(ctx).put(record.id, { ...record, status: "failed" });
      await ctx.kv.delete(`mpu:${record.id}`).catch(() => false);
      return { ok: false, error: "SIZE_MISMATCH" };
    }
  } catch (error) {
    ctx.log.error("Falha ao concluir o multipart", { error: String(error) });
    return { ok: false, error: "COMPLETE_FAILED" };
  }

  const completedAt = new Date().toISOString();
  await uploads(ctx).put(record.id, { ...record, status: "ready", completedAt });
  await ctx.kv.delete(`mpu:${record.id}`).catch(() => false);

  return { ok: true, id: record.id, filename: record.filename, size: record.size, completedAt };
}

export async function handleAbort(ctx: PluginRouteContext) {
  const body = asRecord(ctx.input);
  const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!uploadId || !token) return { ok: false, error: "INVALID_TOKEN" };

  const record = await uploads(ctx).get(uploadId);
  if (!record) return { ok: false, error: "INVALID_TOKEN" };
  const hash = await sha256Hex(token);
  if (!constantTimeEqual(hash, record.tokenHash)) return { ok: false, error: "INVALID_TOKEN" };

  try {
    const bucket = getMediaBucket();
    await bucket.resumeMultipartUpload(record.storageKey, record.r2UploadId).abort();
  } catch {
    // Abortar um multipart inexistente não impede remover o registro.
  }
  await uploads(ctx).delete(record.id);
  await ctx.kv.delete(`mpu:${record.id}`).catch(() => false);
  return { ok: true };
}

// =============================================================================
// Rotas privadas (admin)
// =============================================================================

export async function handleAdminList(ctx: PluginRouteContext) {
  const url = new URL(ctx.request.url);
  const requested = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 100) : 50;
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const result = await uploads(ctx).query({
    orderBy: { createdAt: "desc" },
    limit,
    cursor,
  });

  return {
    ok: true,
    items: result.items.map((item) => toAdminItem(item.id, item.data)),
    nextCursor: result.hasMore ? (result.cursor ?? null) : null,
    hasMore: result.hasMore,
  };
}

export async function handleAdminStats(ctx: PluginRouteContext) {
  const [usedBytes, quotaGb, activeVal] = await Promise.all([
    sumStoredBytes(ctx),
    settingsNumber(ctx, "quotaGb", DEFAULT_QUOTA_GB),
    ctx.kv.get<boolean>("active").catch(() => null),
  ]);
  const active = activeVal !== false;
  const ready = await uploads(ctx)
    .query({ where: { status: "ready" }, limit: 1 })
    .then((result) => (typeof uploads(ctx).count === "function" ? uploads(ctx).count({ status: "ready" }) : result.items.length))
    .catch(() => 0);

  return {
    ok: true,
    active,
    usedBytes,
    quotaBytes: Math.round(quotaGb * GIB),
    count: Number(ready) || 0,
  };
}

export async function handleAdminToggleStatus(ctx: PluginRouteContext) {
  const body = asRecord(ctx.input);
  const active = body.active === true;
  await ctx.kv.set("active", active);
  return { ok: true, active };
}

export async function handleAdminMeta(ctx: PluginRouteContext) {
  const url = new URL(ctx.request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return { ok: false, error: "NOT_FOUND" };

  const record = await uploads(ctx).get(id);
  if (!record) return { ok: false, error: "NOT_FOUND" };
  return {
    ok: true,
    id,
    storageKey: record.storageKey,
    filename: record.filename,
    contentType: record.contentType,
    size: record.size,
    status: record.status,
  };
}

export async function handleAdminDelete(ctx: PluginRouteContext) {
  const body = asRecord(ctx.input);
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return { ok: false, error: "NOT_FOUND" };

  const record = await uploads(ctx).get(id);
  if (!record) return { ok: false, error: "NOT_FOUND" };

  try {
    const bucket = getMediaBucket();
    if (record.status === "pending") {
      await bucket.resumeMultipartUpload(record.storageKey, record.r2UploadId).abort().catch(() => undefined);
    }
    await bucket.delete(record.storageKey);
  } catch (error) {
    // Nunca fingir que apagou: o registro fica e o erro sobe para o painel.
    ctx.log.error("Falha ao excluir objeto do R2", { id, error: String(error) });
    return { ok: false, error: "DELETE_FAILED" };
  }

  await uploads(ctx).delete(id);
  await ctx.kv.delete(`mpu:${id}`).catch(() => false);
  return { ok: true, deleted: true };
}

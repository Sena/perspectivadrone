import type { APIRoute } from "astro";
// @ts-ignore - módulo virtual do runtime Cloudflare (Astro 6 / adapter v13+)
import { env } from "cloudflare:workers";

export const prerender = false;

const ADMIN_ROLE = 50;
const NOINDEX = "noindex, nofollow, noarchive";

interface DownloadMeta {
  storageKey: string;
  filename: string;
  contentType: string;
  size: number;
  status: string;
}

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": NOINDEX,
    },
  });
}

function parseRange(header: string | null, size: number): { start: number; length: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;

  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, size);
    return { start: size - length, length };
  }

  const start = Number(startRaw);
  const end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, length: end - start + 1 };
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const GET: APIRoute = async ({ params, locals, request, url }) => {
  const id = params.id;
  if (!id) return textResponse(400, "Requisição inválida.");

  const user = locals.user;
  if (!user) return textResponse(401, "Faça login para baixar este arquivo.");
  if (typeof user.role !== "number" || user.role < ADMIN_ROLE) {
    return textResponse(403, "Sem permissão para baixar este arquivo.");
  }

  // Os metadados vivem no storage do plugin; a rota privada é a fonte única.
  // Chamamos o handler em processo: `fetch` para o próprio domínio não volta
  // para o script no Workers (a subrequisição morre em 404).
  let meta: DownloadMeta | null = null;
  try {
    const metaUrl = new URL("/_emdash/api/plugins/receber-arquivos/admin/meta", url.origin);
    metaUrl.searchParams.set("id", id);
    const metaRequest = new Request(metaUrl, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const result = await locals.emdash.handlePluginApiRoute(
      "receber-arquivos",
      "GET",
      "admin/meta",
      metaRequest,
      user,
    );
    // `success` já é obrigatório no HandlerResponse do host; só o `data` chega
    // como `unknown` e por isso leva cast.
    const payload = result.data as (DownloadMeta & { ok?: boolean }) | undefined;
    if (result.success && payload?.ok) meta = payload;
  } catch {
    return textResponse(503, "Não foi possível ler o arquivo agora.");
  }

  if (!meta?.storageKey) return textResponse(404, "Arquivo não encontrado.");
  if (meta.status !== "ready") return textResponse(409, "O arquivo ainda não terminou de chegar.");

  const bucket = (env as { MEDIA?: {
    get(key: string, options?: { range?: { offset: number; length: number } }): Promise<
      { body: ReadableStream; size: number } | null
    >;
  } } | undefined)?.MEDIA;
  if (!bucket) return textResponse(503, "Armazenamento indisponível.");

  const range = parseRange(request.headers.get("range"), meta.size);
  const object = await bucket.get(
    meta.storageKey,
    range ? { range: { offset: range.start, length: range.length } } : undefined,
  );
  if (!object) return textResponse(404, "Arquivo não encontrado.");

  const headers = new Headers({
    "content-type": meta.contentType || "application/octet-stream",
    "content-length": String(range ? range.length : meta.size),
    "content-disposition": contentDisposition(meta.filename),
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "x-robots-tag": NOINDEX,
  });
  if (range) {
    headers.set(
      "content-range",
      `bytes ${range.start}-${range.start + range.length - 1}/${meta.size}`,
    );
  }

  return new Response(object.body, { status: range ? 206 : 200, headers });
};

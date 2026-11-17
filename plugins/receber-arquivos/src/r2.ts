/**
 * Acesso ao binding R2 `MEDIA`.
 *
 * Este módulo só pode ser importado por código de runtime (rotas do plugin).
 * O import de `cloudflare:workers` não existe em Node, por isso o descritor
 * vive em `config.ts` e é esse módulo que o `astro.config.mjs` importa.
 */

// @ts-ignore - módulo virtual do runtime Cloudflare, resolvido só no Worker
import { env } from "cloudflare:workers";

export interface R2MultipartUploadLike {
  uploadId: string;
  uploadPart(
    partNumber: number,
    value: ArrayBuffer | ArrayBufferView,
  ): Promise<{ partNumber: number; etag: string }>;
  complete(parts: Array<{ partNumber: number; etag: string }>): Promise<unknown>;
  abort(): Promise<void>;
}

export interface R2BucketLike {
  createMultipartUpload(key: string, options?: unknown): Promise<R2MultipartUploadLike>;
  resumeMultipartUpload(key: string, uploadId: string): Promise<R2MultipartUploadLike>;
  head(key: string): Promise<{ size: number } | null>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<{ body: ReadableStream; size: number } | null>;
  delete(key: string): Promise<void>;
}

export function getMediaBucket(): R2BucketLike {
  const bucket = (env as { MEDIA?: R2BucketLike } | undefined)?.MEDIA;
  if (!bucket) throw new Error("Binding R2 \"MEDIA\" ausente no Worker");
  return bucket;
}

export function hasMediaBucket(): boolean {
  return Boolean((env as { MEDIA?: unknown } | undefined)?.MEDIA);
}

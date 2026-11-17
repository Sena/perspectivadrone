import type { StoredPart, UploadRecord } from "./shared.js";

export interface QueryOptions {
  where?: Record<string, unknown>;
  orderBy?: Record<string, "asc" | "desc">;
  limit?: number;
  cursor?: string;
}

export interface QueryResult {
  items: Array<{ id: string; data: UploadRecord }>;
  cursor?: string;
  hasMore: boolean;
}

export interface UploadsCollection {
  get(id: string): Promise<UploadRecord | null>;
  put(id: string, data: UploadRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  query(options?: QueryOptions): Promise<QueryResult>;
  count?(where?: Record<string, unknown>): Promise<number>;
}

export interface KVAccessLike {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  getVersioned<T>(key: string): Promise<{ value: T; revision: string } | null>;
  compareAndSet(
    key: string,
    expectedRevision: string | null,
    value: unknown,
  ): Promise<{ applied: true; revision: string } | { applied: false }>;
}

export interface SettingsAccessLike {
  get<T>(key: string): Promise<T | null>;
}

export interface LoggerLike {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Recorte estrutural do `RouteContext` do EmDash que as rotas usam.
 * O host passa o contexto completo; este tipo só documenta o que lemos.
 */
export interface PluginRouteContext {
  storage: Record<string, unknown>;
  kv: KVAccessLike;
  settings: SettingsAccessLike;
  log: LoggerLike;
  request: Request;
  requestMeta: {
    ip: string | null;
    userAgent: string | null;
  };
  input?: unknown;
  user?: { role: number };
}

export interface StoredParts {
  parts: StoredPart[];
}

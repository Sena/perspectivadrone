const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(digest);
}

/** Comparação em tempo constante entre duas strings de mesmo tamanho esperado. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Token opaco de 32 bytes (base64url), usado só no upload em andamento. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Nome preservado, mas seguro para virar chave de objeto: remove acentos,
 * separadores de caminho e caracteres de controle, colapsa espaços e trunca
 * o radical em 80 caracteres mantendo a extensão original.
 */
export function sanitizeFilename(raw: string): string {
  const base = (raw || "").split(/[\\/]/).pop() ?? "";
  const normalized = (base || "arquivo").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const dot = normalized.lastIndexOf(".");
  const extension =
    dot > 0
      ? normalized
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 12)
      : "";
  const stemSource = dot > 0 ? normalized.slice(0, dot) : normalized;
  const stem =
    stemSource
      .replace(/[^a-zA-Z0-9._ -]/g, " ")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.\s]+|[-.\s]+$/g, "")
      .slice(0, 80) || "arquivo";
  return extension ? `${stem}.${extension}` : stem;
}

/** `uploads/<ano>/<id>-<nome-sanitizado>` */
export function buildStorageKey(id: string, filename: string, year: number): string {
  return `uploads/${year}/${id}-${sanitizeFilename(filename)}`;
}

/** Id ordenável: prefixo base36 do timestamp + sufixo aleatório. */
export function newRecordId(): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const random = crypto.getRandomValues(new Uint8Array(6));
  let suffix = "";
  for (const byte of random) suffix += byte.toString(36).padStart(2, "0");
  return `${time}${suffix}`.toLowerCase();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

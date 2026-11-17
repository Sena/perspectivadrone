/**
 * Cliente do envio de arquivos grandes (plugin "Receber arquivos").
 *
 * Envia o arquivo em fatias de 5 MiB (o host limita o corpo de rota de plugin
 * a 8 MiB), com 3 tentativas automáticas por fatia e retomada por 24h no mesmo
 * navegador. Sem dependências.
 */

const API = "/_emdash/api/plugins/receber-arquivos";
const RESUME_PREFIX = "receber-arquivos:";
const RETRY_DELAYS_MS = [1000, 3000, 7000];

interface StartData {
  uploadId: string;
  token: string;
  partSize: number;
  totalParts: number;
  expiresAt: string;
}

interface StatusData {
  status: string;
  partSize: number;
  totalParts: number;
  uploadedParts: number[];
  receivedBytes: number;
}

interface ResumeEntry {
  uploadId: string;
  token: string;
  expiresAt: string;
  filename: string;
  size: number;
}

class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  UPLOAD_CLOSED: "Envios temporariamente fechados. Fale com o responsável.",
  FILE_TOO_LARGE: "O arquivo passa do limite permitido.",
  FILE_EMPTY: "O arquivo está vazio.",
  EXPIRED: "O envio anterior expirou. Comece de novo.",
  INVALID_TOKEN: "O envio anterior não é mais válido. Comece de novo.",
  INVALID_PART_SIZE: "Uma fatia chegou corrompida. Tentando de novo…",
  MISSING_PARTS: "Faltou uma fatia para concluir. Tentando de novo…",
  SIZE_MISMATCH: "O arquivo chegou incompleto. Comece de novo.",
  PART_FAILED: "A conexão caiu no meio do envio.",
  COMPLETE_FAILED: "Não foi possível concluir o envio.",
  STORAGE_UNAVAILABLE: "O armazenamento está indisponível agora. Tente em alguns minutos.",
};

function messageFor(code: string): string {
  return MESSAGES[code] ?? "Não foi possível concluir. Tente de novo.";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Cancelado", "AbortError"));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/${path}`, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers as Record<string, string> | undefined) },
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: T & { ok?: boolean; error?: string };
    error?: { code?: string };
  } | null;
  if (!response.ok) {
    throw new ApiError(payload?.error?.code ?? `HTTP_${response.status}`, "Não foi possível falar com o servidor.");
  }
  const data = payload?.data;
  if (!data) throw new ApiError("EMPTY_RESPONSE", "Resposta inesperada do servidor.");
  if (data.ok === false) throw new ApiError(data.error ?? "UNKNOWN", messageFor(data.error ?? "UNKNOWN"));
  return data as T;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** exponent;
  return `${amount.toFixed(exponent >= 2 ? 1 : 0)} ${units[exponent]}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}min ${rest}s`;
}

function fingerprint(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function readResume(file: File): ResumeEntry | null {
  try {
    const raw = localStorage.getItem(`${RESUME_PREFIX}${fingerprint(file)}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as ResumeEntry;
    if (!entry.uploadId || !entry.token) return null;
    if (Date.parse(entry.expiresAt) < Date.now()) {
      localStorage.removeItem(`${RESUME_PREFIX}${fingerprint(file)}`);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function saveResume(file: File, data: StartData): void {
  const entry: ResumeEntry = {
    uploadId: data.uploadId,
    token: data.token,
    expiresAt: data.expiresAt,
    filename: file.name,
    size: file.size,
  };
  try {
    localStorage.setItem(`${RESUME_PREFIX}${fingerprint(file)}`, JSON.stringify(entry));
  } catch {
    // Modo privado/Safari restrito: segue sem retomada.
  }
}

function clearResume(file: File): void {
  try {
    localStorage.removeItem(`${RESUME_PREFIX}${fingerprint(file)}`);
  } catch {
    // ignora
  }
}

function init(): void {
  const root = document.querySelector<HTMLElement>("[data-upload-root]");
  if (!root) return;

  const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

  const form = byId<HTMLFormElement>("ra-form");
  const fileInput = byId<HTMLInputElement>("ra-file");
  const drop = byId<HTMLElement>("ra-drop");
  const fileLabel = byId<HTMLElement>("ra-file-name");
  const submit = byId<HTMLButtonElement>("ra-submit");
  const progress = byId<HTMLElement>("ra-progress");
  const barTrack = byId<HTMLElement>("ra-bar-track");
  const bar = byId<HTMLElement>("ra-bar");
  const percent = byId<HTMLElement>("ra-percent");
  const meta = byId<HTMLElement>("ra-meta");
  const cancel = byId<HTMLButtonElement>("ra-cancel");
  const statusLine = byId<HTMLElement>("ra-status");
  const errorBox = byId<HTMLElement>("ra-error");
  const success = byId<HTMLElement>("ra-success");
  const successName = byId<HTMLElement>("ra-success-name");
  const successMeta = byId<HTMLElement>("ra-success-meta");
  const again = byId<HTMLButtonElement>("ra-again");
  const resumeButton = byId<HTMLButtonElement>("ra-resume");
  const dropTitle = byId<HTMLElement>("ra-drop-title");
  const dropHint = byId<HTMLElement>("ra-drop-hint");
  const dropAction = byId<HTMLElement>("ra-drop-action");
  const selectedChip = byId<HTMLElement>("ra-selected-chip");

  if (!form || !fileInput || !submit) return;

  const partSize = Number(root.dataset.partSize) || 5 * 1024 * 1024;
  const maxBytes = Number(root.dataset.maxBytes) || 0;
  const emptyHint = dropHint?.textContent ?? "";

  let selected: File | null = null;
  let pendingResume: ResumeEntry | null = null;
  let controller: AbortController | null = null;
  let running = false;

  const toggle = (element: HTMLElement | null, visible: boolean) => {
    if (!element) return;
    element.classList.toggle("hidden", !visible);
    if (visible) element.removeAttribute("hidden");
    else element.setAttribute("hidden", "");
  };

  const showError = (message: string) => {
    if (!errorBox) return;
    errorBox.textContent = message;
    toggle(errorBox, true);
  };

  const clearError = () => {
    if (!errorBox) return;
    errorBox.textContent = "";
    toggle(errorBox, false);
  };

  const setStatusLine = (message: string) => {
    if (statusLine) statusLine.textContent = message;
  };

  const setProgress = (sent: number, total: number, startedAt: number) => {
    const ratio = total > 0 ? Math.min(sent / total, 1) : 0;
    const value = Math.round(ratio * 100);
    if (bar) bar.style.width = `${value}%`;
    if (percent) percent.textContent = `${value}%`;
    if (barTrack) barTrack.setAttribute("aria-valuenow", String(value));
    if (meta) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const speed = elapsed > 0 ? sent / elapsed : 0;
      const remaining = speed > 0 ? (total - sent) / speed : Number.POSITIVE_INFINITY;
      meta.textContent = `${formatBytes(sent)} de ${formatBytes(total)} · ${formatBytes(speed)}/s · ${formatDuration(remaining)} restantes`;
    }
  };

  const resetUi = () => {
    toggle(progress, false);
    toggle(success, false);
    toggle(resumeButton, false);
    clearError();
    setStatusLine("");
    if (bar) bar.style.width = "0%";
    if (percent) percent.textContent = "0%";
    running = false;
    syncSubmit();
  };

  // Sem arquivo não há o que enviar: o botão fica inerte e diz o porquê, em
  // vez de aceitar o clique e responder com erro.
  const syncSubmit = () => {
    if (running) {
      submit.disabled = true;
      return;
    }
    submit.disabled = selected === null;
    submit.textContent = selected ? "Enviar arquivo" : "Escolha um arquivo";
  };

  // O bloco precisa mostrar o arquivo escolhido com o mesmo peso do convite
  // inicial — senão a tela parece não ter registrado a seleção.
  const renderSelected = (file: File | null) => {
    if (drop) drop.dataset.state = file ? "selected" : "empty";
    if (dropTitle) dropTitle.textContent = file ? file.name : "Clique para escolher um arquivo";
    if (dropHint) dropHint.textContent = file ? formatBytes(file.size) : emptyHint;
    toggle(dropAction, file !== null);
    toggle(selectedChip, file !== null);
    if (fileLabel) {
      fileLabel.textContent = file
        ? `Arquivo selecionado: ${file.name}, ${formatBytes(file.size)}.`
        : "Nenhum arquivo selecionado";
    }
    syncSubmit();
  };

  const handleSelectedFile = (file: File | null) => {
    selected = null;
    pendingResume = null;
    clearError();
    resetUi();

    if (file && maxBytes > 0 && file.size > maxBytes) {
      if (fileInput) fileInput.value = "";
      renderSelected(null);
      showError(
        `O arquivo tem ${formatBytes(file.size)} e passa do limite de ${formatBytes(maxBytes)}. Escolha outro.`,
      );
      return;
    }

    selected = file;
    renderSelected(file);
    if (!file) return;

    const entry = readResume(file);
    if (entry) {
      pendingResume = entry;
      if (resumeButton) {
        resumeButton.textContent = `Continuar envio anterior (${entry.filename})`;
        toggle(resumeButton, true);
      }
    }
  };

  const startSession = async (
    file: File,
    confirmDuplicate = false,
  ): Promise<StartData> => {
    try {
      const data = await call<StartData>("upload/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
          confirmDuplicate,
        }),
      });
      saveResume(file, data);
      return data;
    } catch (error) {
      if (error instanceof ApiError && error.code === "DUPLICATE" && !confirmDuplicate) {
        const proceed = window.confirm(
          "Já existe um envio deste arquivo. Enviar de novo mesmo assim?",
        );
        if (proceed) return startSession(file, true);
      }
      throw error;
    }
  };

  const sendPart = async (
    file: File,
    data: ResumeEntry,
    partNumber: number,
    signal: AbortSignal,
  ): Promise<void> => {
    const start = (partNumber - 1) * partSize;
    const blob = file.slice(start, Math.min(start + partSize, file.size));
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 7000, signal);
      try {
        await call<{ partNumber: number; etag: string }>(
          `upload/part?uploadId=${encodeURIComponent(data.uploadId)}&partNumber=${partNumber}&token=${encodeURIComponent(data.token)}`,
          { method: "PUT", body: blob, signal },
        );
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        lastError = error;
        setStatusLine(`Conexão instável na fatia ${partNumber}. Tentando de novo…`);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(messageFor("PART_FAILED"));
  };

  const runUpload = async (
    file: File,
    data: ResumeEntry,
    uploadedParts: number[],
  ): Promise<void> => {
    const totalParts = Math.max(1, Math.ceil(file.size / partSize));
    const uploaded = new Set(uploadedParts);
    let sent = 0;
    for (const partNumber of uploaded) {
      sent += partNumber < totalParts ? partSize : file.size - partSize * (totalParts - 1);
    }
    const startedAt = Date.now();

    controller = new AbortController();
    running = true;
    toggle(progress, true);
    submit.disabled = true;
    setStatusLine("Mantenha esta aba aberta até o envio terminar.");
    setProgress(sent, file.size, startedAt);

    try {
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        if (uploaded.has(partNumber)) continue;
        await sendPart(file, data, partNumber, controller.signal);
        sent += partNumber < totalParts ? partSize : file.size - partSize * (totalParts - 1);
        setProgress(sent, file.size, startedAt);
      }

      setStatusLine("Conferindo o arquivo no servidor…");
      const result = await call<{ id: string; filename: string; size: number; completedAt: string }>(
        "upload/complete",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uploadId: data.uploadId, token: data.token }),
        },
      );

      clearResume(file);
      toggle(progress, false);
      toggle(resumeButton, false);
      if (successName) successName.textContent = result.filename;
      if (successMeta) {
        successMeta.textContent = `${formatBytes(result.size)} · ${new Date(result.completedAt).toLocaleString("pt-BR")}`;
      }
      toggle(success, true);
      setStatusLine("");
      if (fileInput) fileInput.value = "";
      selected = null;
      pendingResume = null;
      renderSelected(null);
    } finally {
      running = false;
      controller = null;
      syncSubmit();
    }
  };

  const handleFailure = (error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      setStatusLine("Envio cancelado.");
      return;
    }
    if (error instanceof ApiError) {
      showError(error.message);
      return;
    }
    showError(error instanceof Error ? error.message : messageFor("PART_FAILED"));
  };

  fileInput.addEventListener("change", () => {
    handleSelectedFile(fileInput.files?.[0] ?? null);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (running) return;
    if (!selected) {
      showError("Escolha um arquivo.");
      return;
    }
    clearError();
    toggle(resumeButton, false);
    submit.disabled = true;
    submit.textContent = "Iniciando…";

    try {
      const data = await startSession(selected);
      submit.textContent = "Enviando…";
      await runUpload(selected, { ...data, filename: selected.name, size: selected.size }, []);
    } catch (error) {
      handleFailure(error);
      syncSubmit();
    }
  });

  resumeButton?.addEventListener("click", async () => {
    if (!selected || !pendingResume || running) return;
    clearError();
    toggle(resumeButton, false);
    try {
      const status = await call<StatusData>(
        `upload/status?uploadId=${encodeURIComponent(pendingResume.uploadId)}&token=${encodeURIComponent(pendingResume.token)}`,
        { method: "GET" },
      );
      await runUpload(selected, pendingResume, status.uploadedParts ?? []);
    } catch (error) {
      handleFailure(error);
      toggle(resumeButton, true);
    }
  });

  cancel?.addEventListener("click", async () => {
    if (!pendingResume) {
      controller?.abort();
      resetUi();
      return;
    }
    const snapshot = pendingResume;
    controller?.abort();
    try {
      await call("upload/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId: snapshot.uploadId, token: snapshot.token }),
      });
    } catch {
      // Se o abort falhar, a limpeza preguiçosa de 24h cobre depois.
    }
    if (selected) clearResume(selected);
    resetUi();
    setStatusLine("Envio cancelado.");
    if (fileInput) fileInput.value = "";
    handleSelectedFile(null);
  });

  again?.addEventListener("click", () => {
    resetUi();
    if (fileInput) {
      fileInput.value = "";
      fileInput.focus();
    }
    handleSelectedFile(null);
  });

  window.addEventListener("beforeunload", (event) => {
    if (!running) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

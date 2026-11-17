/**
 * Painel do plugin "Receber arquivos".
 *
 * React puro + estilos inline: o admin do EmDash não traz @cloudflare/kumo nem
 * @phosphor-icons neste site, então nada de dependência nova.
 */

import * as React from "react";

const API = "/_emdash/api/plugins/receber-arquivos";
const PAGE_SIZE = 50;

interface ReceivedItem {
  id: string;
  filename: string;
  size: number;
  contentType: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  ip: string | null;
  userAgent: string | null;
}

interface Stats {
  active?: boolean;
  usedBytes: number;
  quotaBytes: number;
  count: number;
}

interface ListPayload {
  items: ReceivedItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;
  return `${amount.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR");
}

function shortUserAgent(value: string | null): string {
  if (!value) return "—";
  const match = /(Firefox|Edg|Chrome|Safari)\/[\d.]+/.exec(value);
  const browser = match ? match[0] : value.slice(0, 40);
  const mobile = /Mobile|Android|iPhone/.test(value) ? " (mobile)" : "";
  return `${browser}${mobile}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/${path}`, {
    credentials: "same-origin",
    ...init,
    headers: {
      "X-EmDash-Request": "1",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error?.message ?? "Não foi possível falar com o plugin.");
  }
  const data = payload.data as T & { ok?: boolean; error?: string };
  if (data && data.ok === false) throw new Error(data.error ?? "Falha na operação.");
  return data;
}

const muted: React.CSSProperties = { color: "var(--muted-foreground, #6b7280)", fontSize: 13 };

export function ReceberArquivosPage() {
  const [items, setItems] = React.useState<ReceivedItem[]>([]);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [nextStats, page] = await Promise.all([
        request<Stats>("admin/stats"),
        request<ListPayload>(`admin/list?limit=${PAGE_SIZE}`),
      ]);
      setStats(nextStats);
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!cursor) return;
    setBusyId("__more__");
    try {
      const page = await request<ListPayload>(
        `admin/list?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar mais.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: ReceivedItem) => {
    const confirmed = window.confirm(
      `Excluir "${item.filename}" (${formatBytes(item.size)})? O arquivo sai do R2 e não pode ser recuperado.`,
    );
    if (!confirmed) return;
    setBusyId(item.id);
    setError("");
    try {
      await request("admin/delete", { method: "POST", body: JSON.stringify({ id: item.id }) });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      const nextStats = await request<Stats>("admin/stats");
      setStats(nextStats);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Falha ao excluir.");
    } finally {
      setBusyId(null);
    }
  };

  const usageRatio =
    stats && stats.quotaBytes > 0 ? Math.min(stats.usedBytes / stats.quotaBytes, 1) : 0;
  const usageWarning = usageRatio >= 0.8;

  const toggleActive = async () => {
    if (!stats) return;
    const nextState = !(stats.active !== false);
    const confirmed = window.confirm(
      nextState
        ? "Ativar envios? A página /uploads voltará a aceitar novos arquivos."
        : "Desativar envios? Novos uploads serão bloqueados imediatamente.",
    );
    if (!confirmed) return;
    setBusyId("__toggle__");
    setError("");
    try {
      await request("admin/toggle-status", {
        method: "POST",
        body: JSON.stringify({ active: nextState }),
      });
      setStats({ ...stats, active: nextState });
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Falha ao alterar status.");
    } finally {
      setBusyId(null);
    }
  };

  const isPluginActive = stats?.active !== false;

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Receber arquivos</h1>
            {stats ? (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: isPluginActive ? "#dcfce7" : "#fee2e2",
                  color: isPluginActive ? "#166534" : "#991b1b",
                  border: `1px solid ${isPluginActive ? "#bbf7d0" : "#fecaca"}`,
                }}
              >
                {isPluginActive ? "Envios ativos" : "Envios desativados"}
              </span>
            ) : null}
          </div>
          <p style={{ ...muted, marginTop: 6 }}>
            Arquivos enviados pelo link <code>/uploads</code>. Só o administrador baixa ou exclui.
          </p>
        </div>

        {stats ? (
          <button
            type="button"
            onClick={() => void toggleActive()}
            disabled={busyId === "__toggle__"}
            style={{
              border: `1px solid ${isPluginActive ? "#fca5a5" : "var(--primary, #d97706)"}`,
              background: isPluginActive ? "#fff" : "var(--primary, #d97706)",
              color: isPluginActive ? "#dc2626" : "#fff",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 500,
              cursor: busyId === "__toggle__" ? "progress" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {busyId === "__toggle__" ? "Atualizando…" : isPluginActive ? "Desativar envios" : "Ativar envios"}
          </button>
        ) : null}
      </div>

      <div
        style={{
          border: "1px solid var(--border, #e5e7eb)",
          borderRadius: 8,
          padding: "12px 14px",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        Os arquivos ocupam a cota gratuita do R2 (10 GB). Exclua depois de baixar.
        <div style={{ color: !isPluginActive ? "#dc2626" : "#b45309", marginTop: 4 }}>
          {!isPluginActive
            ? "O link /uploads está temporariamente desativado para envios."
            : "Com o plugin ativo, qualquer pessoa com o link /uploads pode enviar. Desative quando o envio terminar."}
        </div>
      </div>

      {stats ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>
              {formatBytes(stats.usedBytes)} de {formatBytes(stats.quotaBytes)} usados
            </span>
            <span style={muted}>
              {stats.count} {stats.count === 1 ? "arquivo" : "arquivos"}
            </span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              background: "var(--border, #e5e7eb)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.round(usageRatio * 100)}%`,
                height: "100%",
                background: usageWarning ? "#dc2626" : "var(--primary, #d97706)",
              }}
            />
          </div>
          {usageWarning ? (
            <span style={{ fontSize: 12, color: "#dc2626" }}>
              Cota quase cheia: novos envios são bloqueados ao atingir o limite.
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            border: "1px solid #fca5a5",
            background: "#fef2f2",
            color: "#991b1b",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p style={muted}>Carregando…</p>
      ) : items.length === 0 ? (
        <p style={muted}>Nenhum arquivo recebido ainda.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border, #e5e7eb)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", background: "var(--muted, #f9fafb)" }}>
                <th style={{ padding: "10px 12px", fontWeight: 600 }}>Arquivo</th>
                <th style={{ padding: "10px 12px", fontWeight: 600 }}>Tamanho</th>
                <th style={{ padding: "10px 12px", fontWeight: 600 }}>Status</th>
                <th style={{ padding: "10px 12px", fontWeight: 600 }}>Enviado em</th>
                <th style={{ padding: "10px 12px", fontWeight: 600 }}>Origem</th>
                <th style={{ padding: "10px 12px", fontWeight: 600 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} style={{ borderTop: "1px solid var(--border, #e5e7eb)" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 500, wordBreak: "break-word" }}>{item.filename}</div>
                    <div style={muted}>{item.contentType}</div>
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    {formatBytes(item.size)}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    {item.status === "ready" ? "Recebido" : item.status === "pending" ? "Em envio" : "Falhou"}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    {formatDate(item.completedAt ?? item.createdAt)}
                  </td>
                  <td style={{ padding: "10px 12px", ...muted }}>
                    <div>{item.ip ?? "—"}</div>
                    <div style={{ fontSize: 12 }}>{shortUserAgent(item.userAgent)}</div>
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    {item.status === "ready" ? (
                      <a
                        href={`/api/receber-arquivos/${encodeURIComponent(item.id)}`}
                        style={{ marginRight: 12 }}
                      >
                        Baixar
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void remove(item)}
                      disabled={busyId === item.id}
                      style={{
                        border: "1px solid var(--border, #e5e7eb)",
                        background: "transparent",
                        borderRadius: 6,
                        padding: "4px 10px",
                        cursor: busyId === item.id ? "progress" : "pointer",
                        color: "#b91c1c",
                      }}
                    >
                      {busyId === item.id ? "Excluindo…" : "Excluir"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor ? (
        <div>
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={busyId === "__more__"}
            style={{
              border: "1px solid var(--border, #e5e7eb)",
              background: "transparent",
              borderRadius: 6,
              padding: "8px 14px",
              cursor: "pointer",
            }}
          >
            {busyId === "__more__" ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const pages = {
  "/": ReceberArquivosPage,
};

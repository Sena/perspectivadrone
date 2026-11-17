import { definePlugin, type ResolvedPlugin } from "emdash";

import { SETTINGS_SCHEMA, STORAGE_DECLARATION } from "./config.js";
import {
  handleAbort,
  handleAdminDelete,
  handleAdminList,
  handleAdminMeta,
  handleAdminStats,
  handleComplete,
  handlePart,
  handleStart,
  handleStatus,
  handleUploadStatus,
} from "./routes.js";
import { PART_SIZE_BYTES, PLUGIN_ADMIN_ENTRY, PLUGIN_ID, PLUGIN_VERSION } from "./shared.js";

/**
 * Implementação carregada pelo host (descriptor `entrypoint` = este pacote).
 * Roda com a autoridade do site: acessa o binding R2 `MEDIA` diretamente.
 */
export function createPlugin(): ResolvedPlugin {
  return definePlugin({
    id: PLUGIN_ID,
    displayName: "Receber arquivos",
    description:
      "Link para clientes enviarem arquivos grandes. Fica disponível enquanto o plugin estiver ativo.",
    version: PLUGIN_VERSION,
    capabilities: [],

    storage: STORAGE_DECLARATION as unknown as Parameters<typeof definePlugin>[0]["storage"],

    hooks: {
      "plugin:activate": async (_event, ctx) => {
        ctx.log.info("Receber arquivos ativo: /uploads aceitando envios");
      },
    },

    routes: {
      // --- Públicas (link enviado ao cliente) ---

      status: {
        public: true,
        methods: ["GET"],
        handler: async (ctx) => handleStatus(ctx),
      },
      "upload/start": {
        public: true,
        methods: ["POST"],
        handler: async (ctx) => handleStart(ctx),
      },
      "upload/status": {
        public: true,
        methods: ["GET"],
        handler: async (ctx) => handleUploadStatus(ctx),
      },
      "upload/part": {
        public: true,
        // POST é o método que o cliente usa em produção: o WAF da zona
        // `perspectivadrone.com.br` bloqueia PUT (e DELETE/PATCH) com 403
        // "Sorry, you have been blocked" antes de chegar ao Worker. O preview
        // em workers.dev não tem essa regra — foi por isso que o upload
        // funcionou lá e falhou em produção. PUT continua aceito para não
        // quebrar clientes antigos/chamadas diretas.
        methods: ["POST", "PUT"],
        // O host lê o corpo antes do handler e o teto declarável é 8 MiB;
        // por isso a fatia é de 5 MiB (mínimo de parte do R2) em vez de stream.
        request: { body: "bytes", maxBytes: PART_SIZE_BYTES },
        handler: async (ctx) => handlePart(ctx),
      },
      "upload/complete": {
        public: true,
        methods: ["POST"],
        handler: async (ctx) => handleComplete(ctx),
      },
      "upload/abort": {
        public: true,
        methods: ["POST"],
        handler: async (ctx) => handleAbort(ctx),
      },

      // --- Privadas (painel) ---

      "admin/list": {
        permission: "plugins:read",
        methods: ["GET"],
        handler: async (ctx) => handleAdminList(ctx),
      },
      "admin/stats": {
        permission: "plugins:read",
        methods: ["GET"],
        handler: async (ctx) => handleAdminStats(ctx),
      },
      "admin/meta": {
        permission: "plugins:read",
        methods: ["GET"],
        handler: async (ctx) => handleAdminMeta(ctx),
      },
      "admin/delete": {
        permission: "plugins:manage",
        methods: ["POST"],
        handler: async (ctx) => handleAdminDelete(ctx),
      },
    },

    admin: {
      entry: PLUGIN_ADMIN_ENTRY,
      settingsSchema: SETTINGS_SCHEMA,
      pages: [{ path: "/", label: "Receber arquivos", icon: "inbox" }],
    },
  });
}

export default createPlugin;
export { receberArquivosPlugin } from "./config.js";

import type { PluginDescriptor, SettingField } from "emdash";

import {
  DEFAULT_MAX_FILE_GB,
  DEFAULT_QUOTA_GB,
  PLUGIN_ADMIN_ENTRY,
  PLUGIN_ENTRYPOINT,
  PLUGIN_ID,
  PLUGIN_VERSION,
} from "./shared.js";

/**
 * Declaração de storage usada tanto pelo descritor (o admin usa para montar a
 * navegação e a tela de configurações) quanto por `definePlugin` (o runtime do
 * host cria as tabelas). Índices: somente campos consultáveis.
 */
export const STORAGE_DECLARATION = {
  uploads: {
    indexes: ["status", "createdAt", ["status", "createdAt"], ["status", "expiresAt"]],
    uniqueIndexes: ["storageKey"],
  },
} as const;

export const SETTINGS_SCHEMA: Record<string, SettingField> = {
  maxFileSizeGb: {
    type: "number",
    label: "Tamanho máximo por arquivo (GB)",
    description: "Limite aceito pelo servidor antes de iniciar a transferência.",
    default: DEFAULT_MAX_FILE_GB,
    min: 1,
    max: 10,
  },
  quotaGb: {
    type: "number",
    label: "Trava de cota (GB)",
    description:
      "Envios são bloqueados quando o total armazenado passa deste valor. Mantenha abaixo dos 10 GB gratuitos do R2.",
    default: DEFAULT_QUOTA_GB,
    min: 1,
    max: 10,
  },
};

/**
 * Descritor consumido pelo `astro.config.mjs`.
 *
 * Atenção: `format` fica no padrão (`"native"`), então o host importa
 * `createPlugin` deste mesmo entrypoint em runtime.
 */
export function receberArquivosPlugin(): PluginDescriptor {
  return {
    id: PLUGIN_ID,
    displayName: "Receber arquivos",
    description:
      "Link para clientes enviarem arquivos grandes. Fica disponível enquanto o plugin estiver ativo.",
    version: PLUGIN_VERSION,
    entrypoint: PLUGIN_ENTRYPOINT,
    adminEntry: PLUGIN_ADMIN_ENTRY,
    capabilities: [],
    adminPages: [{ path: "/", label: "Receber arquivos", icon: "inbox" }],
    settingsSchema: SETTINGS_SCHEMA,
    storage: STORAGE_DECLARATION as unknown as PluginDescriptor["storage"],
  };
}

import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2 } from "@emdash-cms/cloudflare";
import { formsPlugin } from "@emdash-cms/plugin-forms";
import { receberArquivosPlugin } from "@perspectiva/receber-arquivos/config";

import { defineConfig, fontProviders } from "astro/config";
import emdash, { memoryCache } from "emdash/astro";

import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://perspectivadrone.com.br",
  output: "server",
  adapter: cloudflare(),

  image: {
      layout: "constrained",
      responsiveStyles: true,
	},

  integrations: [
      react(),
      emdash({
          database: d1({ binding: "DB", session: "auto", coalesce: true }),
          storage: r2({ binding: "MEDIA" }),
          plugins: [formsPlugin(), receberArquivosPlugin()],
          // Object cache do EmDash (settings, catálogo, taxonomias): 10 min.
          // Não confundir com o route cache do Astro, que fica desligado aqui.
          objectCache: memoryCache({ defaultTtl: 600 }),
          // Placeholder de imagem no admin em vez de caixa vazia.
          imagePlaceholders: true,
          // Nav do admin sem o que este site não usa.
          admin: { hiddenNavItems: ["comments", "bylines"] },
      }),
	],

  fonts: [
      {
          provider: fontProviders.google(),
          name: "Playfair Display",
          cssVariable: "--font-display",
          weights: [400, 500, 600, 700],
          fallbacks: ["serif"],
      },
      {
          provider: fontProviders.google(),
          name: "DM Sans",
          cssVariable: "--font-sans",
          weights: [300, 400, 500, 600, 700],
          fallbacks: ["sans-serif"],
      },
      {
          provider: fontProviders.google(),
          name: "JetBrains Mono",
          cssVariable: "--font-mono",
          weights: [400, 500],
          fallbacks: ["monospace"],
      },
	],

  devToolbar: { enabled: false },

  vite: {
    plugins: [tailwindcss()],
  },
});
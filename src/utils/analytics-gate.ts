/**
 * Gate do GA4.
 *
 * Regra: o GA4 só existe no site público de produção, no host canônico e para
 * visitante anônimo. Preview (`*.workers.dev`), dev server, localhost e sessão
 * de admin nunca contam visita. Fail-closed: sem host canônico válido, não
 * carrega.
 *
 * A função é pura para ser testável sem subir a página.
 */

export interface AnalyticsGateInput {
	/** `Astro.url.host` — inclui porta quando não for a padrão. */
	host: string;
	/** `Astro.site?.host` — host canônico do `astro.config.mjs`. */
	canonicalHost?: string | null;
	/** `import.meta.env.PROD`. */
	isProd: boolean;
	/** `Astro.locals.user` preenchido. */
	hasUser: boolean;
	/** Kill switch opcional (`GA_ENABLED=false`); ausente = ligado. */
	enabled?: boolean;
}

/** Normaliza um host/host:porta; `null` quando não dá para usar. */
export function normalizeHost(value: string | null | undefined): string | null {
	if (typeof value !== "string" || value.trim() === "") return null;
	try {
		const url = new URL(
			value.includes("://") ? value : `https://${value.trim()}`,
		);
		return url.host.toLowerCase();
	} catch {
		return null;
	}
}

/** `true` somente em produção canônica, sem usuário logado. */
export function shouldLoadAnalytics(input: AnalyticsGateInput): boolean {
	if (input.enabled === false) return false;
	if (!input.isProd) return false;
	if (input.hasUser) return false;

	const canonical = normalizeHost(input.canonicalHost);
	const host = normalizeHost(input.host);
	return Boolean(canonical && host && canonical === host);
}

/**
 * Headers de segurança numa fonte só.
 *
 * O `Base.astro` monta o head das páginas públicas, mas ele não alcança o que
 * não é página: `robots.txt`, `sitemap.xml`, `/uploads`, rotas de API. Aqui o
 * header entra em **toda** resposta e só quando a rota não definiu o seu — a
 * rota continua mandando (ex.: `/uploads` com `frame-ancestors 'none'`).
 *
 * CSP só em HTML e fora do admin: `/_emdash/*` tem a política dele, e um
 * documento JSON/XML com CSP é ruído.
 */
import { defineMiddleware } from "astro:middleware";

/** Vale para qualquer resposta, inclusive assets e texto. */
const BASE_HEADERS: Record<string, string> = {
	// Forçar HTTPS (inclusive subdomínios).
	"Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
	// Clickjacking, MIME-sniffing e vazamento de referrer.
	"X-Frame-Options": "SAMEORIGIN",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * `'unsafe-inline'` é obrigatório: os scripts nativos do Astro/EmDash não usam
 * nonce aqui, e um nonce anularia o `'unsafe-inline'` e quebraria a página.
 */
const CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://static.cloudflareinsights.com",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com",
	"font-src 'self' data:",
	"connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net https://cloudflareinsights.com",
	"frame-ancestors 'self'",
	"base-uri 'self'",
	"form-action 'self'",
	"object-src 'none'",
].join("; ");

export const onRequest = defineMiddleware(async (context, next) => {
	const response = await next();
	const headers = new Headers(response.headers);

	for (const [name, value] of Object.entries(BASE_HEADERS)) {
		if (!headers.has(name)) headers.set(name, value);
	}

	const isHtml = (headers.get("content-type") ?? "").includes("text/html");
	const isAdmin = context.url.pathname.startsWith("/_emdash/");
	if (isHtml && !isAdmin && !headers.has("Content-Security-Policy")) {
		headers.set("Content-Security-Policy", CSP);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
});

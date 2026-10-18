/**
 * Responsive image variants for the site.
 *
 * Builds Cloudflare's `/cdn-cgi/image` URLs so the edge serves a variant fit
 * for the space the image occupies, and pairs each place an image is rendered
 * with the `sizes` the browser needs to pick one.
 *
 * Widths are limited by the zone, not by taste: perspectivadrone.com.br only
 * answers the values it already knows (verified 2026-10-17 -- 320/600/640/
 * 768/800/1024/1200/1280/1600/1920/2000/2600 answer 200; every other value,
 * e.g. 384/576/780/900/1088/1440/1536, is refused with the WAF block page,
 * even for real browsers). The lists below are exactly that allowlist. A
 * ladder measured only against the layout would fit better (384/576/780/1088/
 * 1536), but it needs the zone rule updated first -- see BUG-009 in
 * docs/BACKLOG.md.
 *
 * Slots are measured against the layout, never guessed: the portfolio section
 * is a 3-column grid inside `max-w-7xl` with `px-6`/`gap-4`, the about image
 * is half of the section's content width (minus the 4rem gap), the services
 * banner is full content width and the hero is full-bleed (`object-cover`, so
 * in portrait viewports the width it needs is the viewport height times the
 * image's 3:2 ratio). Adding a new place an image is rendered means adding a
 * slot here with its own widths and `sizes`.
 *
 * `quality=85` is Cloudflare's default for the formats the edge produces,
 * pinned here explicitly so the URL shape stays self-describing. The previous
 * `quality=100` means lossless in WebP and sent clients without WebP/AVIF a
 * 2.3 MB JPEG.
 *
 * `onerror=redirect` turns a failed transformation (source missing, not an
 * image, unsupported codec) into a 307 to the original URL, so the visitor
 * still gets the image instead of an error page. It cannot become an open
 * redirect: sources outside the zone's allowed origins are refused with 403
 * before the fallback applies (measured on the sibling zone, same platform).
 *
 * The zone's WAF allowlists the exact URL prefix, so this shape and the zone
 * rule move together.
 */

export interface ImageSlot {
	/** Candidate widths, ascending. Must stay within the zone's allowlist. */
	widths: readonly number[];
	/** `sizes` for the place this image is rendered. */
	sizes: string;
}

/** Hero widths the zone serves (the historical hero ladder). */
const HERO_WIDTHS = [600, 800, 1200, 1600, 2000, 2600] as const;

/** Card widths the zone serves (the historical grid ladder). */
const CARD_WIDTHS = [320, 640, 768, 1024, 1280, 1920] as const;

/** One column of the portfolio grid: (min(100vw, 1280px) - 3rem - 2rem) / 3. */
const PORTFOLIO_ONE_COL =
	"(min-width: 768px) calc((min(100vw, 1280px) - 5rem) / 3), calc(100vw - 3rem)";

/** Featured/landscape cards span two columns plus the 1rem gap. */
const PORTFOLIO_TWO_COL =
	"(min-width: 768px) calc(((min(100vw, 1280px) - 5rem) / 3) * 2 + 1rem), calc(100vw - 3rem)";

export const IMAGE_SLOTS = {
	/** Full-bleed hero (`h-[100dvh]` + `object-cover`). */
	hero: {
		widths: HERO_WIDTHS,
		sizes: "(orientation: portrait) calc(100dvh * 1.5), 100vw",
	},
	/** Standard and portrait cards (one column). */
	portfolioOneCol: { widths: CARD_WIDTHS, sizes: PORTFOLIO_ONE_COL },
	/** Featured and landscape cards (two columns). */
	portfolioTwoCol: { widths: CARD_WIDTHS, sizes: PORTFOLIO_TWO_COL },
	/** About image: half width minus the section's 4rem gap. */
	about: {
		widths: [640, 768, 1024, 1280, 1920],
		sizes: "(min-width: 768px) calc((min(100vw, 1280px) - 7rem) / 2), calc(100vw - 3rem)",
	},
	/** Services CTA banner: full content width, fixed 16rem height. */
	servicesBanner: {
		widths: [768, 1024, 1280, 1920],
		sizes: "(min-width: 1280px) 1232px, calc(100vw - 3rem)",
	},
} as const satisfies Record<string, ImageSlot>;

export type ImageSlotName = keyof typeof IMAGE_SLOTS;

/**
 * `/cdn-cgi/image` URL for a single width.
 *
 * Handles both source shapes the runtime produces: a relative `/_emdash/...`
 * path (the usual case) and an absolute URL of the same site.
 */
export function cdnImagePath(src: string, width: number): string {
	const source = /^https?:\/\//.test(src) ? src : src.replace(/^\/+/, "");
	return `/cdn-cgi/image/onerror=redirect,width=${width},format=auto,quality=85/${source}`;
}

/** `srcset` for a source against a list of widths. */
export function cdnSrcset(src: string, widths: readonly number[]): string {
	return widths.map((w) => `${cdnImagePath(src, w)} ${w}w`).join(", ");
}

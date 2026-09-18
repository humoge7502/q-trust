/**
 * Canonical origin for the deployed site.
 *
 * One constant, consumed by `metadata.metadataBase`, `robots.ts`, `sitemap.ts`
 * and the JSON-LD graph. Keeping it in a module rather than repeating the
 * literal is what stops canonical URLs, the sitemap and structured data from
 * silently disagreeing if the deploy target moves — a mismatch there is
 * invisible in the UI and expensive in search results.
 *
 * Overridable at build time so a preview deployment can emit its own origin
 * instead of advertising the production one.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_QTRUST_SITE_URL ?? "https://humoge7502.github.io/q-trust"
).replace(/\/$/, "");

/** Absolute URL for a site-relative path. */
export function siteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

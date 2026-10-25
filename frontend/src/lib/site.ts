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
 *
 * The fallback is the application origin, not the documentation site. Those are
 * two different deployments: `humoge7502.github.io/q-trust` serves MkDocs, so a
 * build that fell back to it advertised canonicals, sitemap entries and an
 * `og:image` on a host that does not contain the app's routes or assets. The
 * production Vercel build sets the env var, which is why the live HTML is
 * correct; this makes an unconfigured build correct too.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_QTRUST_SITE_URL ?? "https://q-trust-nu.vercel.app"
).replace(/\/$/, "");

/** Absolute URL for a site-relative path. */
export function siteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

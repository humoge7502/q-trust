import type { MetadataRoute } from "next";
import { SITE_URL, siteUrl } from "@/lib/site";

/**
 * `/robots.txt`, generated so the sitemap URL can never drift from
 * `metadataBase` (both read `lib/site.ts`).
 *
 * `/api/` is disallowed: it is the same-origin proxy in front of the backend
 * and has no crawlable content, so letting a crawler walk it only produces
 * noisy 4xx traffic against the proxy's default-deny policy.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}

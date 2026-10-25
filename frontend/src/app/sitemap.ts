import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * `/sitemap.xml`.
 *
 * Only routes that are genuinely public and indexable are listed. `/dashboard`
 * and `/vendors` are wallet-gated and `/v/[id]` is one page per attestation —
 * enumerating those would fill the index with login walls and unbounded
 * per-record URLs, so they are excluded here and marked `noindex` at the route
 * level instead. The two settings are meant to be read together.
 *
 * `lastModified` is intentionally omitted rather than set to build time: a
 * timestamp that changes on every deploy tells crawlers the content changed
 * when it did not, which erodes the signal.
 */
const PUBLIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/scanner", changeFrequency: "monthly", priority: 0.8 },
  { path: "/research", changeFrequency: "monthly", priority: 0.7 },
  { path: "/demo", changeFrequency: "monthly", priority: 0.7 },
  { path: "/why-now", changeFrequency: "monthly", priority: 0.6 },
  { path: "/evidence", changeFrequency: "monthly", priority: 0.8 },
  { path: "/compare", changeFrequency: "monthly", priority: 0.5 },
  { path: "/developers", changeFrequency: "monthly", priority: 0.5 },
  { path: "/v", changeFrequency: "monthly", priority: 0.6 },
  { path: "/certify", changeFrequency: "monthly", priority: 0.7 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: siteUrl(route.path),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}

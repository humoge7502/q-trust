import type { Metadata } from "next";

/**
 * Route metadata for the org dashboard.
 *
 * Exists because `dashboard/page.tsx` is a client component and client
 * components cannot export `metadata`. Without this the route inherited the
 * site-wide default title, so every app surface shared one `<title>`.
 *
 * `noindex` is deliberate: the page is behind a wallet gate, so a crawler can
 * only ever index the "Connect your wallet" wall. `sitemap.ts` excludes this
 * route for the same reason — the two settings are meant to be read together.
 */
export const metadata: Metadata = {
  title: "Org dashboard",
  description:
    "Migration progress, audit results and registered cryptographic assets for your organization.",
  robots: { index: false, follow: false },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

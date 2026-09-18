import type { Metadata } from "next";

/**
 * Route metadata for the vendor portal. Same rationale as
 * `dashboard/layout.tsx`: the page is a client component, so without this it
 * inherited the site-wide default title.
 *
 * `follow: true` (unlike the dashboard) because the portal links out to
 * verification and documentation surfaces that are genuinely worth crawling;
 * only the gated page itself is withheld.
 */
export const metadata: Metadata = {
  title: "Vendor portal",
  description:
    "Submit and review post-quantum readiness attestations for the products your organization supplies.",
  robots: { index: false, follow: true },
};

export default function VendorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

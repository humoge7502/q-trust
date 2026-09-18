/**
 * Root layout for the Q-Trust frontend.
 *
 * The header, footer and skip link live here rather than in individual pages.
 * Before this, only the landing page rendered any navigation: the app routes
 * (`/scanner`, `/dashboard`, `/vendors`, `/v`, `/v/[id]`) had no way to reach
 * each other, so the product read as a set of disconnected screens. Owning the
 * shell at the root also guarantees the skip link's `#main-content` target and
 * the `<main>`/`<footer>` landmarks exist on every route by construction.
 *
 * `body` is `flex min-h-screen flex-col` so a short page still pins the footer
 * to the bottom of the viewport instead of leaving it stranded mid-screen.
 */
import type { Metadata, Viewport } from "next";
import { ErrorBoundary } from "@/components/error-boundary";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header.client";
import { SkipLink } from "@/components/skip-link";
import { fontVariables } from "@/lib/fonts";
import { SITE_URL } from "@/lib/site";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Q-Trust: PQC Migration Coordinator",
    template: "%s · Q-Trust",
  },
  description:
    "Cross-organizational protocol that coordinates the migration from classical to post-quantum cryptography, on Base L2. Scan → score → plan → attest on Base.",
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
  applicationName: "Q-Trust",
  icons: {
    icon: [{ url: "/favicon.ico" }, { url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Q-Trust: PQC Migration Coordinator",
    description: "Scan your estate, score it against NIST and CNSA 2.0 timelines, rank migration with a GNN planner, and anchor evidence on Base L2.",
    url: SITE_URL,
    siteName: "Q-Trust",
    images: [{ url: "/assets/dashboard.png", width: 1200, height: 630, alt: "Q-Trust dashboard: risk gauge, compliance panel and provenance graph" }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Q-Trust: PQC Migration Coordinator",
    description: "PQC migration protocol for real cryptography estates: scan, score, plan, attest on Base L2.",
    images: ["/assets/dashboard.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export const viewport: Viewport = {
  themeColor: "#020618",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fontVariables}>
      <head>
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        {/* X-Frame-Options is set as an HTTP header in next.config.mjs — it
            cannot be set via <meta> (browsers ignore and warn on it). */}
        <meta name="referrer" content="strict-origin-when-cross-origin" />
      </head>
      <body className="flex min-h-screen flex-col bg-slate-950 font-sans text-slate-100 antialiased">
        <ErrorBoundary>
          <Providers>
            <SkipLink />
            <SiteHeader />
            <div id="main-content" className="flex flex-1 flex-col">
              {children}
            </div>
            <SiteFooter />
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}

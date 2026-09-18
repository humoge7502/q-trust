import type { MetadataRoute } from "next";

/**
 * `/manifest.webmanifest`. Next injects the `<link rel="manifest">` for this
 * route automatically.
 *
 * No `display: "standalone"` or service worker: Q-Trust is a data-bound
 * application where a stale cached shell would be actively harmful — an
 * out-of-date attestation view is worse than no view. This manifest exists so
 * the app is installable and correctly titled on mobile home screens, not to
 * pretend the product works offline.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Q-Trust: PQC Migration Coordinator",
    short_name: "Q-Trust",
    description:
      "Scan a cryptography estate, rank migration exposure, and anchor evidence on Base L2.",
    start_url: "/",
    display: "browser",
    background_color: "#020618",
    theme_color: "#020618",
    icons: [
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}

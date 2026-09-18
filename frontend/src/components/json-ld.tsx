/**
 * Structured data for the public landing page.
 *
 * Scope is deliberately narrow — `WebSite` plus `SoftwareApplication`. Anything
 * requiring claims the repository cannot substantiate (ratings, review counts,
 * pricing tiers, customer counts) is omitted rather than invented: fabricated
 * structured data is both misleading to users and grounds for manual action
 * against the domain.
 *
 * `JSON.stringify` output is escaped before it reaches the DOM. Raw `</script>`
 * inside a JSON payload would terminate the tag early and turn structured data
 * into an injection sink, so every `<` is emitted as the `\u003c` escape, which
 * JSON parsers read identically and HTML parsers cannot interpret as markup.
 */
import { SITE_URL, siteUrl } from "@/lib/site";

const GRAPH = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Q-Trust",
      description:
        "Post-quantum cryptography migration coordinator: scan a cryptography estate, rank the exposure, and anchor evidence on Base L2.",
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: "Q-Trust",
      applicationCategory: "SecurityApplication",
      applicationSubCategory: "Post-quantum cryptography migration",
      operatingSystem: "Web",
      url: SITE_URL,
      description:
        "Coordinates the migration from classical to post-quantum cryptography. Scans source, dependencies, binaries and endpoints, scores exposure against NIST and CNSA 2.0 timelines, and anchors tamper-evident migration evidence on Base L2.",
      featureList: [
        "Cryptographic inventory scanning (12+ languages, 10+ manifest formats)",
        "NIST / CNSA 2.0 exposure scoring",
        "GNN-ranked migration planning",
        "CycloneDX CBOM and SARIF export",
        "Hash-only on-chain attestation on Base L2",
        "Wallet-free public verification",
      ],
      isAccessibleForFree: true,
      license: "https://opensource.org/licenses/MIT",
      sameAs: ["https://github.com/humoge7502/q-trust"],
      potentialAction: {
        "@type": "VerifyAction",
        name: "Verify a Q-Trust attestation",
        target: `${siteUrl("/v")}/{assetId}`,
      },
    },
  ],
} as const;

export function JsonLd() {
  const json = JSON.stringify(GRAPH).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

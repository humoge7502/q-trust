/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Allow the API to live on a different origin in development.
  experimental: {
    // React 19 / Next 16 may flag missing server actions config — opt in here.
    serverActions: {
      allowedOrigins: ["localhost:3000", "localhost:3001"],
    },
  },
  // Security headers
  async headers() {
    // Next.js always emits inline bootstrap and RSC-streaming scripts, even in
    // production. A script-src without 'unsafe-inline' blocks them and leaves
    // every page stuck on its loading skeleton because React never hydrates.
    // Dev additionally needs 'unsafe-eval' for HMR. The rest of the policy
    // (object-src, base-uri, frame-ancestors, connect-src) stays locked down.
    const isDev = process.env.NODE_ENV !== "production";
    const apiBase = process.env.NEXT_PUBLIC_QTRUST_API_URL ?? "http://localhost:3001";
    const configuredRpc =
      process.env.NEXT_PUBLIC_QTRUST_BASE_SEPOLIA_RPC ??
      process.env.QTRUST_RPC_URLS ??
      "https://sepolia.base.org";
    let rpcOrigin = "https://sepolia.base.org";
    try {
      rpcOrigin = new URL(configuredRpc.split(",")[0].trim()).origin;
    } catch {
      // keep the default origin when the env value is malformed
    }
    const scriptSrc = isDev
      ? "'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"
      : "'self' 'unsafe-inline' 'wasm-unsafe-eval'";
    const csp = [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: https://ipfs.io https://explorer.walletconnect.com https://*.walletconnect.com",
      [
        "connect-src 'self'",
        apiBase,
        apiBase.replace(/^http/, "ws"),
        rpcOrigin,
        "https://sepolia.base.org",
        "https://mainnet.base.org",
        "wss://relay.walletconnect.com",
        "https://relay.walletconnect.com",
        "https://explorer.walletconnect.com",
        "https://explorer-api.walletconnect.com",
        "https://rpc.walletconnect.com",
        "https://rpc.walletconnect.org",
        "https://pulse.walletconnect.org",
        "https://*.walletconnect.org",
        "wss://*.walletconnect.org",
        "https://api.web3modal.org",
        "https://*.web3modal.org",
        "https://verify.walletconnect.com",
        // MetaMask SDK transport used by RainbowKit's branded MetaMask
        // connector. Browser-extension users can also use the generic
        // injected connector; this keeps the SDK path from being blocked by
        // CSP when the extension is not directly injectable.
        "https://metamask-sdk.api.cx.metamask.io",
        "wss://metamask-sdk.api.cx.metamask.io",
        "https://ipfs.io",
      ].join(" "),
      "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; ");
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;

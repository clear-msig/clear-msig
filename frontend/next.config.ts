// Next.js config for production frontend with remote asset support.
//
// Security headers are applied at the platform edge to every response.
// The CSP intentionally permits inline scripts/styles (Next 15
// hydration emits inline boot scripts, framer-motion + Tailwind
// runtime styles need inline) and broad connect-src (Solana + EVM
// RPC URLs are env-driven and swap per deploy). The hard wins here
// are:
//   - frame-ancestors 'none'  → clickjacking dead
//   - object-src 'none'       → no Flash/PDF nasties
//   - base-uri 'self'         → no <base> hijack
//   - form-action 'self'      → no off-origin form posts
//   - HSTS preload            → strict TLS even on first visit
//   - Referrer-Policy         → no leak of full path to off-origin
//   - X-Content-Type-Options  → no MIME sniffing
// XSS protection rides primarily on React auto-escape (see
// SECURITY.md surface D). The CSP is defense-in-depth.

const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-inline' + 'unsafe-eval' required by Next 15 hydration
      // and by Dynamic SDK's wallet popup. Tightening this needs a
      // nonce-emitting middleware (deferred).
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      // RPC endpoints (Solana + EVM) are env-driven; keep this loose.
      "connect-src 'self' https: wss:",
      // Dynamic widget renders embedded iframes for some flows.
      "frame-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "worker-src 'self' blob:",
    ].join("; "),
  },
];

const nextConfig = {
  // optimizePackageImports rewrites named imports from these
  // packages into deep imports at build time. Without it, every
  // `import { X } from "lucide-react"` pulls the barrel and the
  // bundler can't always recover the dead siblings. Ranked by
  // wins-for-this-app: lucide-react (imported in 60+ files),
  // framer-motion (heavy + scattered), Dynamic SDK (large connector
  // surface), date-fns (a handful of formatters).
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@dynamic-labs/sdk-react-core",
      "date-fns",
    ],
  },
  // Strip console.log in prod but keep .error/.warn - production
  // diagnostics (chain adapters, useProposalSubscription) still need
  // to surface in the browser console.
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets.coingecko.com"
      },
      {
        protocol: "https",
        hostname: "coin-images.coingecko.com"
      }
    ]
  },
  // WalletConnect (transitive via Dynamic) pulls in pino, which tries
  // to resolve pino-pretty + a few other optional logger backends that
  // aren't installed. Runtime is unaffected - they were never used.
  // Two configs because dev runs Turbopack (`next dev --turbopack`) and
  // prod runs Webpack (`next build`); each ignores the other's block.
  turbopack: {
    resolveAlias: {
      "pino-pretty": "./src/empty-module.ts",
      lokijs: "./src/empty-module.ts",
      encoding: "./src/empty-module.ts",
    },
  },
  webpack: (config: { externals?: unknown[] }) => {
    config.externals = [
      ...(config.externals ?? []),
      "pino-pretty",
      "lokijs",
      "encoding",
    ];
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

// Found by testing: no page carried X-Content-Type-Options, X-Frame-Options
// or Referrer-Policy. HSTS is only honoured over HTTPS, so sending it from
// localhost does nothing, and on the deployed site it makes the browser refuse
// plain HTTP from then on.
//
// The Content-Security-Policy is not here. It carries a fresh nonce on every
// request, which a fixed header cannot, so src/middleware.ts sets it (the rules
// are in src/lib/csp.ts).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Note: both reference templates shipped `output: "export"` + a GitHub Pages
  // `basePath`. Neither is carried over — this app renders on a server and
  // calls the FastAPI backend, so static export would break it.
  webpack(config) {
    // TailAdmin imports icons as React components (src/icons/index.tsx).
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });
    return config;
  },
};

export default nextConfig;

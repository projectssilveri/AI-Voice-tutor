import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

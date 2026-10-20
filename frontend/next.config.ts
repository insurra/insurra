import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";

// Only NEXT_PUBLIC_* values are eligible for browser inlining.
loadEnvConfig(path.resolve(__dirname, ".."));

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },
};
export default nextConfig;

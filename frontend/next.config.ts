import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";

// Only NEXT_PUBLIC_* values are eligible for browser inlining.
loadEnvConfig(path.resolve(__dirname, ".."));
const nextConfig: NextConfig = { poweredByHeader: false };
export default nextConfig;

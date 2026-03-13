import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel: default build is server mode so API routes work.
  // Capacitor: run BUILD_FOR_CAPACITOR=1 npm run build to get static export in out/ for native apps.
  ...(process.env.BUILD_FOR_CAPACITOR === "1" && { output: "export" }),
};

export default nextConfig;

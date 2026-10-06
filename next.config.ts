import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      // CSV imports send their parsed rows in one request; the default is 1 MB.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;

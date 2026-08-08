import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Asset uploads are validated again by type-specific limits in the route.
    serverActions: { bodySizeLimit: "55mb" },
  },
};

export default nextConfig;

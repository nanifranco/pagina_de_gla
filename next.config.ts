import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/line-art",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;

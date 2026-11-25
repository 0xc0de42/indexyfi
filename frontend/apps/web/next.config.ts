import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@indexfi/ui"],
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${process.env.PYTHON_API_URL || "http://127.0.0.1:8000"}/:path*` }];
  },
};
export default config;

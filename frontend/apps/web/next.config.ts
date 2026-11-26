import type { NextConfig } from "next";
const config: NextConfig = {
  // Separate build dir lets the integration stack run beside a normal `next dev` (Next locks one dev server per dir).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@indexfi/ui"],
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${process.env.PYTHON_API_URL || "http://127.0.0.1:8000"}/:path*` }];
  },
};
export default config;

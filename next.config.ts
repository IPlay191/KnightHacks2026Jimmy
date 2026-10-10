import type { NextConfig } from "next";

/**
 * Static security headers (NFR-2.8). The Content-Security-Policy is set per
 * request in `src/proxy.ts` because it carries a nonce.
 */
const securityHeaders = [
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

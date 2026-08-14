import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  /**
   * Workspace packages ship TypeScript source rather than a build output, so
   * Next compiles them alongside the app. This is what lets `packages/*` have
   * no build step of their own.
   */
  transpilePackages: [
    "@behindthestory/db",
    "@behindthestory/core",
    "@behindthestory/ai",
  ],

  /**
   * The browser only ever talks to this origin; Next forwards the migrated
   * paths to the API service. That keeps the session cookie first-party, so
   * there is no CORS config and no `credentials: "include"` anywhere in the
   * client.
   *
   * Only migrated paths are listed. Everything still served by this app's own
   * route handlers falls through untouched, which is what makes the port
   * incremental rather than a cutover.
   *
   * Mobile skips this entirely and calls the API directly with a bearer token.
   */
  async rewrites() {
    return [
      { source: "/api/auth/:path*", destination: `${API_URL}/api/auth/:path*` },
      { source: "/api/novels", destination: `${API_URL}/api/novels` },
      // One segment only — `/api/novels/:id/search` and friends still belong to
      // this app until they are ported.
      { source: "/api/novels/:novelId", destination: `${API_URL}/api/novels/:novelId` },
    ];
  },
};

export default nextConfig;

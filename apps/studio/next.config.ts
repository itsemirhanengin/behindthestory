import path from "node:path";

import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  /**
   * Railway runs this as a container, not on Vercel. `standalone` emits
   * `.next/standalone` with only the traced files plus a `server.js`, so the
   * runtime image carries no `node_modules` install of its own.
   */
  output: "standalone",

  /**
   * Tracing defaults to the directory holding this config, which would cut off
   * everything in `packages/*` and the pnpm store at the repo root. Scripts run
   * with the package directory as cwd (both `next build` here and `turbo build`
   * from the root), so the monorepo root is two levels up.
   */
  outputFileTracingRoot: path.join(process.cwd(), "../.."),

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
   * Every API path now lives in the service; this app serves pages only. The
   * list stays explicit rather than becoming `/api/:path*` so that adding a
   * route handler back here — for something genuinely page-adjacent — does not
   * silently get swallowed by the proxy.
   *
   * Mobile skips this entirely and calls the API directly with a bearer token.
   */
  async rewrites() {
    return [
      { source: "/api/auth/:path*", destination: `${API_URL}/api/auth/:path*` },
      { source: "/api/novels/:path*", destination: `${API_URL}/api/novels/:path*` },
      { source: "/api/chapters/:path*", destination: `${API_URL}/api/chapters/:path*` },
      { source: "/api/entities/:path*", destination: `${API_URL}/api/entities/:path*` },
      { source: "/api/ai/:path*", destination: `${API_URL}/api/ai/:path*` },
    ];
  },
};

export default nextConfig;

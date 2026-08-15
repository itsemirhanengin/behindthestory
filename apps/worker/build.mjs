import { build } from "esbuild";

import { assertExternalsAreDeclared } from "../../scripts/bundle-externals.mjs";

/**
 * Bundles the workspace packages, externalises everything else.
 *
 * The distinction matters in both directions. `@behindthestory/*` ships
 * TypeScript source with extensionless relative imports, so Node cannot load it
 * at runtime — it has to be compiled in. Everything from npm has to stay out:
 * `pg` and friends use dynamic `require`, which does not survive being bundled
 * into ESM and fails at import time with "Dynamic require of events".
 *
 * Reading the app's own dependency list is not enough, because npm packages
 * reached through a workspace package (pg via @behindthestory/db) are not
 * listed here. Deciding at resolve time is.
 */
const bundleWorkspaceOnly = {
  name: "bundle-workspace-only",
  setup(build) {
    // Bare specifiers only — relative paths fall through and get bundled.
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      // `#...` is this app's own subpath-import map, not a package.
      if (args.path.startsWith("#")) return null;
      if (args.path.startsWith("@behindthestory/")) return null;
      return { path: args.path, external: true };
    });
  },
};

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/index.js",
  plugins: [bundleWorkspaceOnly],
  logLevel: "info",
  metafile: true,
});

// Everything externalised above has to exist in the runtime image, and the
// Dockerfile builds that from this manifest alone. See scripts/.
assertExternalsAreDeclared(result.metafile, "package.json");

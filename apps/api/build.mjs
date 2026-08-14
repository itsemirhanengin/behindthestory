import { readFile } from "node:fs/promises";
import { build } from "esbuild";

/**
 * Externalises npm dependencies but bundles the workspace packages.
 *
 * `--packages=external` cannot make that distinction: it leaves
 * `@behindthestory/*` unbundled too, and those ship TypeScript source with
 * extensionless relative imports. Node then tries to load `./schema` at runtime
 * and fails — which is exactly the shape of a Just-in-Time package, and exactly
 * why the consumer has to compile it.
 */
const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url)));
const external = Object.keys(pkg.dependencies ?? {}).filter(
  (name) => !name.startsWith("@behindthestory/"),
);

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/index.js",
  external,
  logLevel: "info",
});

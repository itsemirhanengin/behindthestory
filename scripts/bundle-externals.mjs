import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";

/**
 * Shared by each app's `build.mjs`.
 *
 * The apps bundle `@behindthestory/*` and externalise everything from npm, so
 * `dist/index.js` ends up importing bare package names that have to be present
 * in `node_modules` at runtime. The Dockerfiles produce that `node_modules`
 * with `pnpm deploy --prod`, which installs exactly the dependencies the *app*
 * declares — and nothing else.
 *
 * Those two facts disagree whenever a workspace package gains a dependency.
 * `packages/core` requiring `@polar-sh/sdk` puts that import in the app's
 * bundle without putting the package in the app's manifest, so pnpm has no
 * reason to install it at the root where the bundle looks. pnpm's isolated
 * layout is what makes this bite: the package is on disk, nested under the
 * workspace package that asked for it, invisible from `/app/dist/index.js`.
 *
 * Nothing catches it before the container starts. It builds, it ships, and it
 * dies on the first line with `ERR_MODULE_NOT_FOUND` — for the worker, that
 * means a service that silently stops draining its queues.
 */

/** Package name for an import specifier: `react/jsx-runtime` → `react`. */
function packageName(specifier) {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}

const BUILTINS = new Set(builtinModules);

/**
 * Every npm package the built bundle will `import` at runtime, read from
 * esbuild's own record of what it externalised rather than by re-parsing the
 * output — multi-line and side-effect imports are easy to miss with a regex,
 * and a miss here is a package that is not checked.
 */
export function externalPackages(metafile) {
  const packages = new Set();
  for (const input of Object.values(metafile.inputs)) {
    for (const imported of input.imports ?? []) {
      if (!imported.external) continue;
      const specifier = imported.path;
      if (specifier.startsWith(".") || specifier.startsWith("#")) continue;
      if (specifier.startsWith("node:")) continue;
      const name = packageName(specifier);
      if (BUILTINS.has(name)) continue;
      packages.add(name);
    }
  }
  return packages;
}

/**
 * Throws unless the app declares every package its bundle imports.
 *
 * Deliberately fatal. A warning would scroll past in CI and the failure it
 * predicts happens in production, one deploy later, with a stack trace that
 * names the package but not the reason it is absent.
 */
export function assertExternalsAreDeclared(metafile, manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const declared = new Set(Object.keys(manifest.dependencies ?? {}));

  const missing = [...externalPackages(metafile)]
    .filter((name) => !declared.has(name))
    .sort();

  if (missing.length === 0) return;

  throw new Error(
    `${manifest.name} bundles imports of ${missing.length} package(s) it does not depend on:\n` +
      missing.map((name) => `  ${name}`).join("\n") +
      `\n\nThese reach the bundle through a workspace package. ` +
      `\`pnpm deploy --prod\` only installs what this app lists, so the ` +
      `container would start and immediately fail with ERR_MODULE_NOT_FOUND. ` +
      `Add them to ${manifestPath}.`,
  );
}

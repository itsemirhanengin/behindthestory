import { defineConfig } from "drizzle-kit";

/**
 * The schema and its migrations live together, in the package that owns them.
 *
 * This used to sit in `apps/studio`, which meant the Next app was the only
 * place a schema change could be generated from — awkward, since the runtime
 * consumers are `apps/api` and `apps/worker`.
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

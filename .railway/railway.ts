import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  redis,
  service,
} from "railway/iac";

const REPO = "itsemirhanengin/behindthestory";

/**
 * Both services build from the repository root so that the Dockerfiles can see
 * the whole workspace — the apps import `packages/*` as TypeScript source and
 * pnpm needs the lockfile plus every manifest to resolve. Leaving
 * `rootDirectory` unset keeps the build context at the root;
 * `RAILWAY_DOCKERFILE_PATH` then selects which Dockerfile to run.
 *
 * Secrets are `preserve()`d rather than written here: this file is committed,
 * and the values are set once with `railway variable set`. Applying the config
 * again keeps whatever is already stored — which is also what lets the same
 * file describe two environments holding different credentials.
 *
 * ## Environments
 *
 * `production` and `dev` run the same three services from the same file,
 * differing only in what this program computes from `ctx`. The split earns its
 * keep in exactly the places local Docker cannot reach: the real image build,
 * migrations running against a real Postgres on boot, and a payment provider
 * delivering webhooks to a public hostname.
 *
 * The branch mapping is the point of the whole arrangement — `dev` tracks the
 * `dev` branch and production tracks `main`, so there is somewhere to see a
 * change deployed before it reaches a paying writer. Pointing both at `main`
 * would give two copies of the same code and nothing to test.
 *
 * Two things this file cannot express, both of which live only in Railway's
 * own state and are easy to lose when a service is recreated:
 *
 * - Custom domains. `railway config apply` rejects them outright; attach them
 *   with `railway domain <name> --port <p> --service <s>`, once per
 *   environment.
 * - Push-to-deploy triggers. Declaring `source: github(...)` tells Railway
 *   where the code is, but the webhook that redeploys on push is a separate
 *   `deploymentTrigger` record, and Railway can only create it once the GitHub
 *   App is installed on the repository. Services applied before the app was
 *   installed came up with a source and no trigger — they built when deployed
 *   by hand and then silently ignored every push. Verify with
 *   `railway api 'query { project(id: "...") { deploymentTriggers { edges { node { serviceId branch } } } } }'`
 *   and expect one row per service per environment.
 */
export default defineRailway((ctx) => {
  const isProduction = ctx.isEnvironment("production");

  /**
   * Postgres and Redis are Railway's, not a third party's.
   *
   * The apps reach them over private DNS, so no credential and no query ever
   * crosses the public internet, and the whole topology — services, databases,
   * and the wiring between them — is one file in git rather than a set of
   * connection strings pasted from three dashboards.
   *
   * Postgres holds novels and a money ledger, so it is the one resource whose
   * failure mode is not "restart it". Turn on point-in-time recovery from the
   * service's Backups tab the day it is created: the restore window starts
   * when PITR is enabled, not retroactively, so a database that has been
   * running unprotected for a month cannot be rewound into that month.
   */
  const db = postgres("postgres");
  const cache = redis("redis");

  /** Which branch this environment deploys. */
  const branch = isProduction ? "main" : "dev";

  /** The studio's public origin — where checkout returns the writer to. */
  const appUrl = isProduction
    ? "https://studio.behindthestory.co"
    : "https://studio.dev.behindthestory.co";

  /**
   * Real money only in production.
   *
   * `dev` points at the Polar sandbox, which is a separate organisation with
   * its own token, its own product ids and its own webhook endpoint — so every
   * `POLAR_*` value below differs between the two environments even though the
   * variable names do not. That is precisely why they are `preserve()`d.
   */
  const polarServer = isProduction ? "production" : "sandbox";

  /**
   * Idle sleep, on everything outside production.
   *
   * Railway bills memory and CPU by the minute a container is up, and a dev
   * environment is idle for almost all of them. Sleeping cuts that to roughly
   * what it is actually used for.
   *
   * The cost is a cold start on the first request after a quiet spell, which
   * for the API means booting and running migrations before it answers. That
   * is fine for a person clicking around, and survivable for a Polar sandbox
   * webhook: a delivery slow enough to time out is retried, and by then the
   * container is awake. Never turn this on in production, where the first
   * request after midnight would be a paying writer's.
   */
  const sleepWhenIdle = !isProduction;

  const api = service("api", {
    source: github(REPO, { branch }),
    healthcheck: "/health",
    deploy: { sleepApplication: sleepWhenIdle },
    // api.behindthestory.co / api.dev.behindthestory.co are attached with
    // `railway domain`: custom-domain registration is rejected by `apply`.
    env: {
      RAILWAY_DOCKERFILE_PATH: "apps/api/Dockerfile",
      NODE_ENV: "production",
      PORT: "3001",

      /**
       * Which model writes prose is a per-workspace choice now, resolved
       * against the catalogue in `packages/ai/src/models.ts` — there is no
       * single server-wide answer to pin here any more.
       */

      APP_URL: appUrl,
      POLAR_SERVER: polarServer,

      // Private DNS, resolved per environment — dev's API can never reach
      // production's database even though the variable name is the same.
      DATABASE_URL: db.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,

      AUTH_SECRET: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM: preserve(),
      AI_GATEWAY_API_KEY: preserve(),

      /**
       * Polar. Sandbox and production are separate organisations with separate
       * ids, so these are stored per environment rather than written here.
       *
       * The webhook endpoint must point at the API's own hostname, not the
       * studio: Polar does not follow redirects, and a 3xx counts as a failed
       * delivery. Ten consecutive failures disable the endpoint.
       */
      POLAR_ACCESS_TOKEN: preserve(),
      POLAR_WEBHOOK_SECRET: preserve(),
      POLAR_PRODUCT_STARTER_MONTHLY: preserve(),
      POLAR_PRODUCT_PRO_MONTHLY: preserve(),
      POLAR_PRODUCT_TEAM_MONTHLY: preserve(),
      POLAR_PRODUCT_WORDS_30K: preserve(),
      POLAR_PRODUCT_WORDS_100K: preserve(),
      POLAR_PRODUCT_WORDS_300K: preserve(),
    },
  });

  const studio = service("studio", {
    source: github(REPO, { branch }),
    deploy: { sleepApplication: sleepWhenIdle },
    env: {
      RAILWAY_DOCKERFILE_PATH: "apps/studio/Dockerfile",
      NODE_ENV: "production",
      PORT: "3000",

      /**
       * Read during `next build`, not at runtime: Next freezes rewrite
       * destinations into routes-manifest.json. `apps/studio/Dockerfile`
       * declares a matching `ARG API_URL`, which is what makes this service
       * variable visible to the build. The hostname is Railway's private DNS
       * name for the `api` service above — private DNS is per environment, so
       * the same string resolves to this environment's API and never crosses
       * over. Browser traffic never leaves the studio origin, which is what
       * keeps the session cookie first-party.
       */
      API_URL: "http://api.railway.internal:3001",
    },
  });

  /**
   * No domain and no healthcheck: the worker serves no HTTP. It reaches Redis
   * and Postgres outbound only, so nothing needs to reach it.
   *
   * Which is exactly why it must not sleep, in any environment. Railway wakes
   * a sleeping service on inbound traffic, and this one has no inbound traffic
   * by design — so it would go to sleep and stay there. The queues it drains
   * are not all request-driven: the hold sweep and the nightly billing
   * reconcile are timers, and a sleeping worker simply never runs them. Held
   * words would stay held and cancelled subscriptions would keep their quota,
   * with nothing anywhere reporting a failure.
   */
  const worker = service("worker", {
    source: github(REPO, { branch }),
    env: {
      RAILWAY_DOCKERFILE_PATH: "apps/worker/Dockerfile",
      NODE_ENV: "production",
      POLAR_SERVER: polarServer,

      DATABASE_URL: db.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      // Needed to decrypt queued sign-in codes, which are sealed with a key
      // derived from this secret rather than written to Redis in the clear.
      AUTH_SECRET: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM: preserve(),
      AI_GATEWAY_API_KEY: preserve(),
      // The nightly reconcile reads subscription state; it never writes.
      POLAR_ACCESS_TOKEN: preserve(),
      POLAR_PRODUCT_STARTER_MONTHLY: preserve(),
      POLAR_PRODUCT_PRO_MONTHLY: preserve(),
      POLAR_PRODUCT_TEAM_MONTHLY: preserve(),
      POLAR_PRODUCT_WORDS_30K: preserve(),
      POLAR_PRODUCT_WORDS_100K: preserve(),
      POLAR_PRODUCT_WORDS_300K: preserve(),
    },
  });

  return project("behindthestory", {
    resources: [db, cache, api, studio, worker],
  });
});

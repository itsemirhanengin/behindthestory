import { defineRailway, github, preserve, project, service } from "railway/iac";

const REPO = "itsemirhanengin/behindthestory";

/**
 * Both services build from the repository root so that the Dockerfiles can see
 * the whole workspace — the apps import `packages/*` as TypeScript source and
 * pnpm needs the lockfile plus every manifest to resolve. Leaving
 * `rootDirectory` unset keeps the build context at the root;
 * `RAILWAY_DOCKERFILE_PATH` then selects which Dockerfile to run.
 *
 * Secrets are `preserve()`d rather than written here: this file is committed,
 * and the values are set once with `railway variables --set`. Applying the
 * config again keeps whatever is already stored.
 */
export default defineRailway(() => {
  const api = service("api", {
    source: github(REPO, { branch: "main" }),
    healthcheck: "/health",
    // api.behindthestory.co is attached with `railway domain`: custom-domain
    // registration is rejected by `railway config apply`.
    env: {
      RAILWAY_DOCKERFILE_PATH: "apps/api/Dockerfile",
      NODE_ENV: "production",
      PORT: "3001",
      AI_MODEL: "anthropic/claude-sonnet-5",

      DATABASE_URL: preserve(),
      REDIS_URL: preserve(),
      AUTH_SECRET: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM: preserve(),
      AI_GATEWAY_API_KEY: preserve(),
    },
  });

  const studio = service("studio", {
    source: github(REPO, { branch: "main" }),
    env: {
      RAILWAY_DOCKERFILE_PATH: "apps/studio/Dockerfile",
      NODE_ENV: "production",
      PORT: "3000",

      /**
       * Read during `next build`, not at runtime: Next freezes rewrite
       * destinations into routes-manifest.json. `apps/studio/Dockerfile`
       * declares a matching `ARG API_URL`, which is what makes this service
       * variable visible to the build. The hostname is Railway's private DNS
       * name for the `api` service above, so browser traffic never leaves the
       * studio origin and the session cookie stays first-party.
       */
      API_URL: "http://api.railway.internal:3001",
    },
  });

  return project("behindthestory", {
    resources: [api, studio],
  });
});

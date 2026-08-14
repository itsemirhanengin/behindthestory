# Backlog

Deferred work. Nothing here blocks anything; each item is written down so it
does not have to be rediscovered.

## Delete the dead Vercel wiring from the repo

`apps/studio/.env.local` still carries `VERCEL_OIDC_TOKEN` and the Neon/Vercel
variables that `vercel env pull` wrote, and the repo root still has a `.vercel/`
directory holding `project.json`.

None of it is read any more: the studio serves pages only, and the API
authenticates to the AI Gateway with `AI_GATEWAY_API_KEY`. It is worth deleting
rather than leaving in place, because `@vercel/oidc` walks up from the working
directory looking for exactly that `.vercel/project.json` and will silently
authenticate through the local Vercel CLI session if it finds one. That is how
AI calls kept working locally while no credential was configured — a failure
that only appears once the code runs somewhere without the developer's CLI
login.

## Unify the duplicated local environment files

`apps/api/.env` and `apps/studio/.env.local` hold the same `DATABASE_URL`,
`REDIS_URL`, `AUTH_SECRET`, `RESEND_API_KEY` and `EMAIL_FROM` values. Changing
one without the other produces a split-brain local setup.

Production is already single-source: each Railway service owns its variables.
Only local development still duplicates.

Keep the values unquoted. `node --env-file` accepts quoted and unquoted alike,
but `docker --env-file` treats quotes as part of the value — a quoted
`AI_GATEWAY_API_KEY` reaches the container as `"vck_...` and the gateway answers
with an empty stream rather than an error.

## Decide what `behindthestory.co` serves

The apex currently serves a GoDaddy parking page. The studio is on
`studio.behindthestory.co` and the API on `api.behindthestory.co`.

The apex is not on Railway on purpose: GoDaddy does not support CNAME on `@`,
and Railway issues an apex CNAME. Pointing the apex at Railway means moving
nameservers to a provider with CNAME flattening (Cloudflare), so it is a DNS
migration rather than a record change. The alternative is a redirect from the
apex to `studio.`.

## Tear down the Vercel project

Deployment has moved to Railway and nothing routes to Vercel any more. The
project, its domains and its environment variables are still there.

Worth confirming no preview URL is referenced anywhere before deleting, since
Vercel preview links live in PR comments and browser bookmarks.

-- Moves every existing account and novel into the workspace model.
--
-- Written as a migration rather than left to a script because the schema
-- change alone is a trapdoor: authorisation now joins novels to the caller
-- through `workspace_members`, so the instant 0001 lands, every novel with a
-- null `workspace_id` is invisible to everybody. Shipping the two separately
-- means a window — however short — where the writer's shelf is empty.
--
-- Idempotent throughout: it only touches accounts with no membership and
-- novels with no workspace, so re-running it is a no-op. Novels whose
-- `owner_id` is also null predate authentication and are deliberately left
-- alone; `db:claim` assigns those first.

-- A personal workspace, and its owner membership, per account that has none.
--
-- A loop rather than two set-based inserts: creating the workspaces in bulk
-- gives no way to say which account each one belongs to, and pairing them
-- afterwards by creation order is the kind of clever that is only correct
-- until it isn't. There are a handful of rows here; clarity wins.
DO $$
DECLARE
  account RECORD;
  label TEXT;
  new_workspace UUID;
BEGIN
  FOR account IN
    SELECT u."id", u."email", u."display_name"
      FROM "users" u
     WHERE NOT EXISTS (
       SELECT 1 FROM "workspace_members" m WHERE m."user_id" = u."id"
     )
     ORDER BY u."created_at"
  LOOP
    label := COALESCE(
      NULLIF(account."display_name", ''),
      NULLIF(split_part(account."email", '@', 1), ''),
      'Workspace'
    );

    INSERT INTO "workspaces" ("name", "slug")
    VALUES (
      label,
      -- Random suffix rather than a uniqueness retry: two accounts called
      -- `ada` would otherwise collide on the unique slug index.
      regexp_replace(lower(label), '[^a-z0-9]+', '-', 'g')
        || '-' || substr(md5(random()::text || account."id"::text), 1, 6)
    )
    RETURNING "id" INTO new_workspace;

    INSERT INTO "workspace_members" ("workspace_id", "user_id", "role")
    VALUES (new_workspace, account."id", 'owner');
  END LOOP;
END $$;
--> statement-breakpoint

-- Each novel joins its creator's oldest workspace, which after the step above
-- is their personal one.
UPDATE "novels" n
   SET "workspace_id" = m."workspace_id"
  FROM (
    SELECT DISTINCT ON ("user_id") "user_id", "workspace_id"
      FROM "workspace_members"
     ORDER BY "user_id", "created_at"
  ) m
 WHERE n."workspace_id" IS NULL
   AND n."owner_id" = m."user_id";
--> statement-breakpoint

-- Seed the balance so the first generation after the upgrade is not refused
-- for want of a row. Free is the correct starting plan; a paid subscription
-- overwrites it on the next webhook or nightly reconcile.
--
-- The allowance is written as a literal because a migration is a historical
-- record: it must keep meaning what it meant the day it ran, even after
-- `PLANS.free.monthlyWords` changes. Every later grant reads the constant.
INSERT INTO "workspace_balances" ("workspace_id", "plan_slug", "plan_words_remaining", "period_start", "period_end")
SELECT w."id", 'free', 10000, now(), now() + interval '1 month'
  FROM "workspaces" w
 WHERE NOT EXISTS (
   SELECT 1 FROM "workspace_balances" b WHERE b."workspace_id" = w."id"
 );
--> statement-breakpoint

-- Existing generations belong to the workspace that now owns their novel.
-- Without this the first billing summary reports an empty period despite a
-- shelf full of work.
UPDATE "ai_generations" g
   SET "workspace_id" = n."workspace_id"
  FROM "novels" n
 WHERE g."workspace_id" IS NULL
   AND g."novel_id" = n."id";

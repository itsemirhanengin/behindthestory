-- Handles are NOT NULL and unique, so an existing row needs one before the
-- constraint can be added. Added nullable, backfilled deterministically from
-- the account id, then tightened -- the standard three-step, because
-- `ADD COLUMN ... NOT NULL` with no default fails outright on a non-empty table.
--
-- The backfilled name is ugly on purpose. It is valid under the handle rules in
-- `packages/core/src/username.ts` (lower-case, hyphen-separated, not reserved)
-- and unique by construction, and the account holder is expected to change it
-- on their profile page. New accounts get a minted name instead, never this.
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
UPDATE "users" SET "username" = 'writer-' || substr(replace("id"::text, '-', ''), 1, 20) WHERE "username" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "favorite_genres" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_pov" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "writing_goal" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "influences" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avoids" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");
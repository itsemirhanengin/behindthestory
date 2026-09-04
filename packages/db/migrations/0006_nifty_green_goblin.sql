DROP INDEX "novel_drafts_user_idx";--> statement-breakpoint
CREATE INDEX "novel_drafts_user_idx" ON "novel_drafts" USING btree ("user_id");
CREATE TABLE "novel_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"max_step" integer DEFAULT 0 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"title_from_ai" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reading" jsonb,
	"reading_revision" integer DEFAULT 0 NOT NULL,
	"turns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"style" jsonb,
	"style_proposal" jsonb,
	"style_from" integer DEFAULT -1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "novel_drafts" ADD CONSTRAINT "novel_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "novel_drafts_user_idx" ON "novel_drafts" USING btree ("user_id");
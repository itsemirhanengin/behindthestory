CREATE TABLE "word_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"delta" integer NOT NULL,
	"plan_delta" integer DEFAULT 0 NOT NULL,
	"topup_delta" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"request_id" text NOT NULL,
	"generation_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"plan_words_after" integer DEFAULT 0 NOT NULL,
	"topup_words_after" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_balances" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"plan_slug" text DEFAULT 'free' NOT NULL,
	"plan_words_remaining" integer DEFAULT 0 NOT NULL,
	"topup_words_remaining" integer DEFAULT 0 NOT NULL,
	"words_held" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp DEFAULT now() NOT NULL,
	"period_end" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_generations" DROP CONSTRAINT "ai_generations_novel_id_novels_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_generations" ALTER COLUMN "novel_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD COLUMN "reasoning_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD COLUMN "usd_cost" numeric(12, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD COLUMN "words_charged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD COLUMN "source" text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "word_ledger" ADD CONSTRAINT "word_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_ledger" ADD CONSTRAINT "word_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_ledger" ADD CONSTRAINT "word_ledger_generation_id_ai_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."ai_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_balances" ADD CONSTRAINT "workspace_balances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "word_ledger_idempotency_idx" ON "word_ledger" USING btree ("workspace_id","request_id","reason");--> statement-breakpoint
CREATE INDEX "word_ledger_workspace_idx" ON "word_ledger" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "word_ledger_reason_idx" ON "word_ledger" USING btree ("reason","created_at");--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_generations_workspace_idx" ON "ai_generations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_generations_request_idx" ON "ai_generations" USING btree ("request_id");
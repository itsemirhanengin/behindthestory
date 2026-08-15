CREATE TABLE IF NOT EXISTS "ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"novel_id" uuid NOT NULL,
	"chapter_id" uuid,
	"route" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_suggestion_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"novel_id" uuid NOT NULL,
	"chapter_id" uuid,
	"decision" text NOT NULL,
	"mode" text NOT NULL,
	"route" text NOT NULL,
	"label" text NOT NULL,
	"suggestion_text" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"feedback_prompted" boolean DEFAULT false NOT NULL,
	"rating" integer,
	"comment" text,
	"decided_at" timestamp DEFAULT now() NOT NULL,
	"feedback_submitted_at" timestamp,
	CONSTRAINT "ai_suggestion_feedback_suggestion_id_unique" UNIQUE("suggestion_id"),
	CONSTRAINT "ai_suggestion_feedback_rating_range" CHECK ("ai_suggestion_feedback"."rating" is null or ("ai_suggestion_feedback"."rating" >= 1 and "ai_suggestion_feedback"."rating" <= 5))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canon_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"novel_id" uuid NOT NULL,
	"source_type" text DEFAULT 'chapter' NOT NULL,
	"source_id" uuid NOT NULL,
	"chapter_number" integer DEFAULT 0 NOT NULL,
	"chapter_title" text DEFAULT '' NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chapter_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"content" text NOT NULL,
	"label" text DEFAULT 'manual' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"novel_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"variant_label" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"act" integer DEFAULT 1 NOT NULL,
	"title" text DEFAULT 'Untitled Chapter' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"outline" text DEFAULT '' NOT NULL,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"continues_from_previous" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"novel_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"chapter_id" uuid,
	"fact" text NOT NULL,
	"origin" text DEFAULT 'ai' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"novel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'side' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"backstory" text DEFAULT '' NOT NULL,
	"traits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"appearance" text DEFAULT '' NOT NULL,
	"secrets" text DEFAULT '' NOT NULL,
	"voice" text DEFAULT '' NOT NULL,
	"speech_sample" text DEFAULT '' NOT NULL,
	"motivation" text DEFAULT '' NOT NULL,
	"arc" text DEFAULT '' NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"color" text DEFAULT '#8c3a2b' NOT NULL,
	"pos_x" real DEFAULT 0 NOT NULL,
	"pos_y" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "location_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"novel_id" uuid NOT NULL,
	"source_location_id" uuid NOT NULL,
	"target_location_id" uuid NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"novel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"atmosphere" text DEFAULT '' NOT NULL,
	"significance" text DEFAULT '' NOT NULL,
	"character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"pos_x" real DEFAULT 0 NOT NULL,
	"pos_y" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "novels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"title" text NOT NULL,
	"premise" text DEFAULT '' NOT NULL,
	"genre" text DEFAULT '' NOT NULL,
	"tone" text DEFAULT '' NOT NULL,
	"pov" text DEFAULT 'third_limited' NOT NULL,
	"tense" text DEFAULT 'past' NOT NULL,
	"target_chapter_words" integer DEFAULT 1800 NOT NULL,
	"style_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"novel_id" uuid NOT NULL,
	"source_character_id" uuid NOT NULL,
	"target_character_id" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"significance" text DEFAULT '' NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"client" text DEFAULT 'web' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "story_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"novel_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planted' NOT NULL,
	"introduced_in_chapter_id" uuid,
	"resolved_in_chapter_id" uuid,
	"related_character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text DEFAULT 'ai' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "story_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"novel_id" uuid NOT NULL,
	"relationship_id" uuid,
	"character_id" uuid,
	"chapter_id" uuid,
	"chapter_number" integer DEFAULT 0 NOT NULL,
	"rel_type" text,
	"closeness" integer,
	"char_status" text,
	"cause" text DEFAULT '' NOT NULL,
	"driver_character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"impact" text DEFAULT 'major' NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_events_subject_state" CHECK ((
        "story_events"."relationship_id" is not null and "story_events"."character_id" is null
          and "story_events"."rel_type" is not null and "story_events"."closeness" is not null
          and "story_events"."char_status" is null
      ) or (
        "story_events"."character_id" is not null and "story_events"."relationship_id" is null
          and "story_events"."char_status" is not null
          and "story_events"."rel_type" is null and "story_events"."closeness" is null
      )),
	CONSTRAINT "story_events_closeness_range" CHECK ("story_events"."closeness" is null or ("story_events"."closeness" >= 1 and "story_events"."closeness" <= 10)),
	CONSTRAINT "story_events_chapter_number" CHECK ("story_events"."chapter_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_suggestion_feedback" ADD CONSTRAINT "ai_suggestion_feedback_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_suggestion_feedback" ADD CONSTRAINT "ai_suggestion_feedback_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canon_chunks" ADD CONSTRAINT "canon_chunks_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canon_chunks" ADD CONSTRAINT "canon_chunks_source_id_chapters_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chapter_revisions" ADD CONSTRAINT "chapter_revisions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chapters" ADD CONSTRAINT "chapters_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_facts" ADD CONSTRAINT "character_facts_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_facts" ADD CONSTRAINT "character_facts_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_facts" ADD CONSTRAINT "character_facts_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characters" ADD CONSTRAINT "characters_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_links" ADD CONSTRAINT "location_links_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_links" ADD CONSTRAINT "location_links_source_location_id_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_links" ADD CONSTRAINT "location_links_target_location_id_locations_id_fk" FOREIGN KEY ("target_location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "novels" ADD CONSTRAINT "novels_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relationships" ADD CONSTRAINT "relationships_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relationships" ADD CONSTRAINT "relationships_source_character_id_characters_id_fk" FOREIGN KEY ("source_character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relationships" ADD CONSTRAINT "relationships_target_character_id_characters_id_fk" FOREIGN KEY ("target_character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "story_elements" ADD CONSTRAINT "story_elements_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "story_elements" ADD CONSTRAINT "story_elements_introduced_in_chapter_id_chapters_id_fk" FOREIGN KEY ("introduced_in_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "story_elements" ADD CONSTRAINT "story_elements_resolved_in_chapter_id_chapters_id_fk" FOREIGN KEY ("resolved_in_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "story_events" ADD CONSTRAINT "story_events_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "story_events" ADD CONSTRAINT "story_events_relationship_id_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."relationships"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "story_events" ADD CONSTRAINT "story_events_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "story_events" ADD CONSTRAINT "story_events_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_generations_novel_idx" ON "ai_generations" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_suggestion_feedback_novel_idx" ON "ai_suggestion_feedback" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_suggestion_feedback_chapter_idx" ON "ai_suggestion_feedback" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_suggestion_feedback_decision_idx" ON "ai_suggestion_feedback" USING btree ("novel_id","decision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canon_chunks_novel_idx" ON "canon_chunks" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canon_chunks_source_idx" ON "canon_chunks" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canon_chunks_embedding_idx" ON "canon_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapter_revisions_chapter_idx" ON "chapter_revisions" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapters_novel_idx" ON "chapters" USING btree ("novel_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chapters_variant_slot_idx" ON "chapters" USING btree ("novel_id","number","variant_label");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chapters_active_slot_idx" ON "chapters" USING btree ("novel_id","number") WHERE "chapters"."is_active";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_facts_novel_idx" ON "character_facts" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_facts_character_idx" ON "character_facts" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_novel_idx" ON "characters" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "locations_novel_idx" ON "locations" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationships_novel_idx" ON "relationships" USING btree ("novel_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_elements_novel_idx" ON "story_elements" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_events_novel_idx" ON "story_events" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_events_relationship_idx" ON "story_events" USING btree ("relationship_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_events_character_idx" ON "story_events" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_events_chapter_idx" ON "story_events" USING btree ("novel_id","chapter_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");
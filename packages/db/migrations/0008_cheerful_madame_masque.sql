CREATE TABLE "billing_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'polar' NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_subscription_id" text,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"fully_refunded" boolean NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "pending_plan_slug" text;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "pending_plan_at" timestamp;--> statement-breakpoint
ALTER TABLE "billing_refunds" ADD CONSTRAINT "billing_refunds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
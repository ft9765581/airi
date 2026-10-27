CREATE TABLE "intent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sample_set_version" integer NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"config_key" text NOT NULL,
	"model_id" text,
	"classifier_prompt_digest" text,
	"embedding_endpoint" text,
	"embedding_model" text,
	"embedding_margin" text,
	"total" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb,
	"cases" jsonb,
	"failure_reason" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "intent_samples" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"input" text NOT NULL,
	"previous" text,
	"previous_role" text DEFAULT 'user' NOT NULL,
	"group" text NOT NULL,
	"expected" text NOT NULL,
	"label_status" text DEFAULT 'unreviewed' NOT NULL,
	"source" text,
	"sample_set_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "intent_runs_owner_idx" ON "intent_runs" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "intent_samples_owner_idx" ON "intent_samples" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "intent_samples_set_idx" ON "intent_samples" USING btree ("user_id","sample_set_version");
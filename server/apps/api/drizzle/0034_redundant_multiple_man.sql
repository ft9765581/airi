ALTER TABLE "intent_runs" ADD COLUMN "collection_id" text;--> statement-breakpoint
ALTER TABLE "intent_runs" ADD COLUMN "purpose" text DEFAULT 'development' NOT NULL;
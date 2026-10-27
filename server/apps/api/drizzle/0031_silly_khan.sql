CREATE TABLE "intent_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text DEFAULT 'development' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "intent_samples" ADD COLUMN "collection_id" text;--> statement-breakpoint
CREATE INDEX "intent_collections_owner_idx" ON "intent_collections" USING btree ("user_id","deleted_at");
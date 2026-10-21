CREATE TABLE "user_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"character_id" text NOT NULL,
	"scope" text NOT NULL,
	"content" text NOT NULL,
	"importance" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "user_memories_owner_created_idx" ON "user_memories" USING btree ("owner_id","created_at");
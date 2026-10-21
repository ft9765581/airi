ALTER TABLE "user_memories" ADD COLUMN "recall_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN "last_recalled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "intent_samples" ALTER COLUMN "expected" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "intent_runs" DROP COLUMN "embedding_endpoint";--> statement-breakpoint
ALTER TABLE "intent_runs" DROP COLUMN "embedding_model";--> statement-breakpoint
ALTER TABLE "intent_runs" DROP COLUMN "embedding_margin";
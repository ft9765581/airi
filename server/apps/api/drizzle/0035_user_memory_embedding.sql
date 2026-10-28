ALTER TABLE "user_memories" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
-- vchordrq cosine index. The default build keeps one partition, which fits this table until it is large.
-- PGlite tests push the Drizzle schema and do not run this statement.
CREATE INDEX "user_memories_embedding_idx" ON "user_memories" USING vchordrq ("embedding" vector_cosine_ops);
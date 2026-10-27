ALTER TABLE "intent_samples" ADD COLUMN "context" jsonb;
UPDATE "intent_samples" SET "context" = jsonb_build_array(jsonb_build_object('role', "previous_role", 'content', "previous")) WHERE "previous" IS NOT NULL AND "context" IS NULL;

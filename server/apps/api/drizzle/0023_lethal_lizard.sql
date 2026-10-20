--
-- The provider config id is unique per owner, not globally.
--
-- A client keeps a stable provider id such as `deepseek` in its module
-- selections, so every account stores the same id for the same source. The
-- original global primary key let the first account claim those ids, and every
-- later account failed to upload its providers with a duplicate-key error.
--
-- drizzle-kit cannot name an existing primary key, so it emitted only the
-- ADD CONSTRAINT below. The drop is added by hand; the constraint name comes
-- from `information_schema.table_constraints` (default name for the table).
--
ALTER TABLE "user_provider_configs" DROP CONSTRAINT "user_provider_configs_pkey";--> statement-breakpoint
ALTER TABLE "user_provider_configs" ADD CONSTRAINT "user_provider_configs_owner_id_id_pk" PRIMARY KEY("owner_id","id");

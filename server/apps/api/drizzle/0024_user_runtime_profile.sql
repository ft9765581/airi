CREATE TABLE "user_runtime_cards" (
	"owner_id" text NOT NULL,
	"card_id" text NOT NULL,
	"card" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "user_runtime_cards_owner_id_card_id_pk" PRIMARY KEY("owner_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "user_runtime_settings" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"active_card_id" text NOT NULL,
	"active_card_updated_at" timestamp with time zone NOT NULL,
	"profile_content" text DEFAULT '' NOT NULL,
	"profile_updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);

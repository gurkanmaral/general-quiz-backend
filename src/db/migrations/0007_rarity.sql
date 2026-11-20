CREATE TABLE "kno_progress"."rarity" (
	"award_slug" text PRIMARY KEY NOT NULL,
	"holders" integer NOT NULL,
	"ranked_accounts" integer NOT NULL,
	"percent" double precision NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);

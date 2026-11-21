CREATE TABLE "kno_daily"."fallback_assignment" (
	"daily_date" date PRIMARY KEY NOT NULL,
	"question_slug" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);

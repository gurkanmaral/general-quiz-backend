CREATE SCHEMA "kno_content";
--> statement-breakpoint
CREATE TYPE "kno_content"."report_source" AS ENUM('daily', 'solo', 'lobby');--> statement-breakpoint
CREATE TYPE "kno_content"."report_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "kno_content"."report" (
	"id" text PRIMARY KEY NOT NULL,
	"question_slug" text NOT NULL,
	"user_id" text NOT NULL,
	"source" "kno_content"."report_source" NOT NULL,
	"note" text,
	"status" "kno_content"."report_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "kno_content"."report" ADD CONSTRAINT "report_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "kno_content"."report" USING btree ("status","question_slug");
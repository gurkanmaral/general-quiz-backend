CREATE TABLE "kno_progress"."equipped_title" (
	"user_id" text PRIMARY KEY NOT NULL,
	"award_slug" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kno_progress"."equipped_title" ADD CONSTRAINT "equipped_title_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;
CREATE TABLE "kno_social"."nudge" (
	"sender_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"daily_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nudge_sender_id_recipient_id_daily_date_pk" PRIMARY KEY("sender_id","recipient_id","daily_date")
);
--> statement-breakpoint
CREATE TABLE "kno_social"."settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"receive_nudges" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kno_social"."nudge" ADD CONSTRAINT "nudge_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kno_social"."nudge" ADD CONSTRAINT "nudge_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kno_social"."settings" ADD CONSTRAINT "settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;
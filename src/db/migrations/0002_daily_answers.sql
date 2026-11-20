CREATE TABLE "kno_daily"."answer" (
	"user_id" text NOT NULL,
	"daily_date" date NOT NULL,
	"question_slug" text NOT NULL,
	"selected_index" smallint NOT NULL,
	"correct" boolean NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	"played_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_user_id_daily_date_pk" PRIMARY KEY("user_id","daily_date")
);
--> statement-breakpoint
ALTER TABLE "kno_daily"."answer" ADD CONSTRAINT "answer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;
CREATE SCHEMA "kno_progress";
--> statement-breakpoint
CREATE TABLE "kno_progress"."correct_question" (
	"user_id" text NOT NULL,
	"quiz_slug" text NOT NULL,
	"question_slug" text NOT NULL,
	"first_correct_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correct_question_user_id_question_slug_pk" PRIMARY KEY("user_id","question_slug")
);
--> statement-breakpoint
CREATE TABLE "kno_progress"."quiz_record" (
	"user_id" text NOT NULL,
	"quiz_slug" text NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"games_won" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_record_user_id_quiz_slug_pk" PRIMARY KEY("user_id","quiz_slug")
);
--> statement-breakpoint
ALTER TABLE "kno_progress"."correct_question" ADD CONSTRAINT "correct_question_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kno_progress"."quiz_record" ADD CONSTRAINT "quiz_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "correct_question_quiz_idx" ON "kno_progress"."correct_question" USING btree ("user_id","quiz_slug");
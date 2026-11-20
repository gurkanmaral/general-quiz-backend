CREATE TYPE "kno_quizzes"."award_kind" AS ENUM('badge', 'title');--> statement-breakpoint
CREATE TABLE "kno_quizzes"."award" (
	"slug" text PRIMARY KEY NOT NULL,
	"quiz_slug" text NOT NULL,
	"kind" "kno_quizzes"."award_kind" NOT NULL,
	"status" "kno_quizzes"."content_status" NOT NULL,
	"position" integer NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb NOT NULL,
	"icon" text NOT NULL,
	"unlock" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kno_progress"."user_award" (
	"user_id" text NOT NULL,
	"award_slug" text NOT NULL,
	"quiz_slug" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_award_user_id_award_slug_pk" PRIMARY KEY("user_id","award_slug")
);
--> statement-breakpoint
ALTER TABLE "kno_quizzes"."award" ADD CONSTRAINT "award_quiz_slug_quiz_slug_fk" FOREIGN KEY ("quiz_slug") REFERENCES "kno_quizzes"."quiz"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kno_progress"."user_award" ADD CONSTRAINT "user_award_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_award_award_idx" ON "kno_progress"."user_award" USING btree ("award_slug");
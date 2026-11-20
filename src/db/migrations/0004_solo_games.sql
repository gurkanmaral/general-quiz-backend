CREATE TYPE "kno_quizzes"."solo_game_status" AS ENUM('active', 'finished', 'abandoned');--> statement-breakpoint
CREATE TABLE "kno_quizzes"."solo_answer" (
	"game_id" text NOT NULL,
	"position" smallint NOT NULL,
	"question_slug" text NOT NULL,
	"selected_index" smallint NOT NULL,
	"correct" boolean NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "solo_answer_game_id_position_pk" PRIMARY KEY("game_id","position")
);
--> statement-breakpoint
CREATE TABLE "kno_quizzes"."solo_game" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"quiz_slug" text NOT NULL,
	"question_slugs" text[] NOT NULL,
	"status" "kno_quizzes"."solo_game_status" DEFAULT 'active' NOT NULL,
	"answered" smallint DEFAULT 0 NOT NULL,
	"score" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "kno_quizzes"."solo_answer" ADD CONSTRAINT "solo_answer_game_id_solo_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "kno_quizzes"."solo_game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kno_quizzes"."solo_game" ADD CONSTRAINT "solo_game_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kno_quizzes"."solo_game" ADD CONSTRAINT "solo_game_quiz_slug_quiz_slug_fk" FOREIGN KEY ("quiz_slug") REFERENCES "kno_quizzes"."quiz"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "solo_game_user_idx" ON "kno_quizzes"."solo_game" USING btree ("user_id","status");
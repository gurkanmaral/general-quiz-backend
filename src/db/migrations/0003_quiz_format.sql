CREATE TYPE "kno_quizzes"."question_difficulty" AS ENUM('standard', 'expert');--> statement-breakpoint
CREATE TYPE "kno_quizzes"."quiz_kind" AS ENUM('quiz', 'dailyPool');--> statement-breakpoint
ALTER TABLE "kno_quizzes"."question" ADD COLUMN "difficulty" "kno_quizzes"."question_difficulty" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "kno_quizzes"."quiz" ADD COLUMN "kind" "kno_quizzes"."quiz_kind" DEFAULT 'quiz' NOT NULL;--> statement-breakpoint
ALTER TABLE "kno_quizzes"."quiz" ADD COLUMN "description" jsonb;--> statement-breakpoint
ALTER TABLE "kno_quizzes"."quiz" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "kno_quizzes"."quiz" ADD COLUMN "theme" text;--> statement-breakpoint
ALTER TABLE "kno_quizzes"."quiz" ADD COLUMN "expert_share" double precision DEFAULT 0.3 NOT NULL;
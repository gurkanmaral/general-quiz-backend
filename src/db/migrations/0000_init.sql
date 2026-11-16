CREATE SCHEMA "kno_daily";
--> statement-breakpoint
CREATE SCHEMA "kno_quizzes";
--> statement-breakpoint
CREATE TYPE "kno_quizzes"."content_status" AS ENUM('published', 'unpublished');--> statement-breakpoint
CREATE TABLE "kno_quizzes"."question" (
	"slug" text PRIMARY KEY NOT NULL,
	"quiz_slug" text NOT NULL,
	"position" integer NOT NULL,
	"status" "kno_quizzes"."content_status" NOT NULL,
	"category" text NOT NULL,
	"theme" text NOT NULL,
	"correct_index" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kno_quizzes"."quiz" (
	"slug" text PRIMARY KEY NOT NULL,
	"status" "kno_quizzes"."content_status" NOT NULL,
	"title" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kno_daily"."rotation" (
	"position" integer PRIMARY KEY NOT NULL,
	"question_slug" text NOT NULL,
	"anchor" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kno_daily"."schedule_entry" (
	"daily_date" date PRIMARY KEY NOT NULL,
	"question_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kno_quizzes"."question" ADD CONSTRAINT "question_quiz_slug_quiz_slug_fk" FOREIGN KEY ("quiz_slug") REFERENCES "kno_quizzes"."quiz"("slug") ON DELETE no action ON UPDATE no action;
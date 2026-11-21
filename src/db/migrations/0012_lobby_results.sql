CREATE SCHEMA "kno_lobbies";
--> statement-breakpoint
CREATE TABLE "kno_lobbies"."lobby_game" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"quiz_slug" text NOT NULL,
	"question_count" integer NOT NULL,
	"ended_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kno_lobbies"."lobby_game_player" (
	"game_id" text NOT NULL,
	"user_id" text NOT NULL,
	"score" integer NOT NULL,
	"correct" integer NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "lobby_game_player_game_id_user_id_pk" PRIMARY KEY("game_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "kno_lobbies"."lobby_game_player" ADD CONSTRAINT "lobby_game_player_game_id_lobby_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "kno_lobbies"."lobby_game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kno_lobbies"."lobby_game_player" ADD CONSTRAINT "lobby_game_player_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lobby_game_player_user_idx" ON "kno_lobbies"."lobby_game_player" USING btree ("user_id");
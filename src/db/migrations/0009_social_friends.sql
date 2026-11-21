CREATE SCHEMA "kno_social";
--> statement-breakpoint
CREATE TABLE "kno_social"."friend_request" (
	"id" text PRIMARY KEY NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_request_pair_uq" UNIQUE("from_user_id","to_user_id")
);
--> statement-breakpoint
CREATE TABLE "kno_social"."friendship" (
	"user_id" text NOT NULL,
	"friend_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendship_user_id_friend_id_pk" PRIMARY KEY("user_id","friend_id")
);
--> statement-breakpoint
CREATE TABLE "kno_social"."player_link" (
	"user_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "kno_social"."friend_request" ADD CONSTRAINT "friend_request_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kno_social"."friend_request" ADD CONSTRAINT "friend_request_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kno_social"."friendship" ADD CONSTRAINT "friendship_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kno_social"."friendship" ADD CONSTRAINT "friendship_friend_id_user_id_fk" FOREIGN KEY ("friend_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kno_social"."player_link" ADD CONSTRAINT "player_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "kno_accounts"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_request_to_idx" ON "kno_social"."friend_request" USING btree ("to_user_id");
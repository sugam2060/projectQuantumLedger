CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"platform_user_id" uuid,
	"refresh_token_hash" text NOT NULL,
	"client_type" text NOT NULL,
	"terminal_id" uuid,
	"persistent" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "sessions_one_actor_chk" CHECK (num_nonnulls(user_id, platform_user_id) = 1),
	CONSTRAINT "sessions_hash_chk" CHECK (refresh_token_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_token_hash_uq" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "sessions_platform_user_active_idx" ON "sessions" USING btree ("platform_user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE POLICY "sessions_select_own" ON "sessions" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        (user_id IS NOT NULL AND user_id = app.current_user_id())
        OR (platform_user_id IS NOT NULL
            AND platform_user_id = app.current_platform_user_id())
      );
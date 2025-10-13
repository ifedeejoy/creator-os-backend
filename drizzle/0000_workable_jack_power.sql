CREATE TABLE IF NOT EXISTS "creator_discoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(255) NOT NULL,
	"source" varchar(50) DEFAULT 'scraper',
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"attempts" integer DEFAULT 0,
	"last_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tiktok_id" varchar(100) NOT NULL,
	"username" varchar(255) NOT NULL,
	"follower_count" integer,
	"following_count" integer,
	"total_likes" bigint,
	"video_count" integer,
	"bio" text,
	"profile_data" jsonb,
	"last_scraped_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "creators_tiktok_id_unique" UNIQUE("tiktok_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"total_views" integer DEFAULT 0,
	"total_likes" integer DEFAULT 0,
	"total_comments" integer DEFAULT 0,
	"total_shares" integer DEFAULT 0,
	"follower_count" integer,
	"avg_engagement_rate" numeric(5, 2),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tiktok_id" varchar(100) NOT NULL,
	"username" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"avatar_url" text,
	"follower_count" integer,
	"following_count" integer,
	"total_likes" bigint,
	"bio" text,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_tiktok_id_unique" UNIQUE("tiktok_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tiktok_video_id" varchar(100) NOT NULL,
	"description" text,
	"view_count" integer DEFAULT 0,
	"like_count" integer DEFAULT 0,
	"comment_count" integer DEFAULT 0,
	"share_count" integer DEFAULT 0,
	"engagement_rate" numeric(5, 2),
	"video_created_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "videos_tiktok_video_id_unique" UNIQUE("tiktok_video_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "videos" ADD CONSTRAINT "videos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creator_discoveries_username_idx" ON "creator_discoveries" USING btree ("username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creator_discoveries_status_idx" ON "creator_discoveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creators_username_idx" ON "creators" USING btree ("username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creators_followers_idx" ON "creators" USING btree ("follower_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metrics_user_date_idx" ON "daily_metrics" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "videos_user_idx" ON "videos" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "videos_engagement_idx" ON "videos" USING btree ("engagement_rate");
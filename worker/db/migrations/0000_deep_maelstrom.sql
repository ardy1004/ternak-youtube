CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`handle` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`r2_prefix` text NOT NULL,
	`zernio_api_key_enc` text,
	`zernio_account_id` text,
	`target_market` text,
	`content_type` text,
	`content_lang` text,
	`timezone` text DEFAULT 'Asia/Jakarta' NOT NULL,
	`videos_per_day` integer DEFAULT 1 NOT NULL,
	`window_start` text DEFAULT '08:00' NOT NULL,
	`window_end` text DEFAULT '21:00' NOT NULL,
	`interval_min` integer DEFAULT 180 NOT NULL,
	`active_days` text DEFAULT '1,2,3,4,5,6,7' NOT NULL,
	`max_uploads_per_day` integer DEFAULT 3 NOT NULL,
	`yt_visibility` text DEFAULT 'public' NOT NULL,
	`yt_category` text DEFAULT '22' NOT NULL,
	`yt_made_for_kids` integer DEFAULT false NOT NULL,
	`yt_playlist_id` text,
	`baseline_tags` text,
	`ai_tone` text,
	`ai_output_lang` text,
	`ai_few_shot` text,
	`ai_cta_template` text,
	`warmup_enabled` integer DEFAULT true NOT NULL,
	`warmup_days` integer DEFAULT 30 NOT NULL,
	`warmup_start_per_day` integer DEFAULT 1 NOT NULL,
	`warmup_started_at` text,
	`is_verified` integer DEFAULT false NOT NULL,
	`last_built_date` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	CONSTRAINT "channels_status" CHECK("channels"."status" IN ('active','paused'))
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`finished_at` text,
	`detail_json` text,
	CONSTRAINT "job_runs_status" CHECK("job_runs"."status" IN ('running','success','partial','failed'))
);
--> statement-breakpoint
CREATE INDEX `job_runs_type_started` ON `job_runs` (`job_type`,`started_at`);--> statement-breakpoint
CREATE TABLE `metric_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`scheduled_post_id` text NOT NULL,
	`captured_on` text NOT NULL,
	`captured_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`provider_updated_at` text,
	`views` integer,
	`watch_time_sec` integer,
	`likes` integer,
	`comments` integer,
	`subs_gained` integer,
	`raw_json` text,
	FOREIGN KEY (`scheduled_post_id`) REFERENCES `scheduled_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metric_snapshots_post_day` ON `metric_snapshots` (`scheduled_post_id`,`captured_on`);--> statement-breakpoint
CREATE TABLE `scheduled_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`slot_time_utc` text NOT NULL,
	`zernio_post_id` text,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`fail_reason` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`dispatched_at` text,
	`published_at` text,
	`dry_run` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `video_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduled_posts_status" CHECK("scheduled_posts"."status" IN ('queued','dispatching','scheduled','published','failed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_posts_idempotency_key_unique` ON `scheduled_posts` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `scheduled_posts_status_slot` ON `scheduled_posts` (`status`,`slot_time_utc`);--> statement-breakpoint
CREATE INDEX `scheduled_posts_channel_slot` ON `scheduled_posts` (`channel_id`,`slot_time_utc`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`dry_run` integer DEFAULT true NOT NULL,
	`ai_output_lang` text DEFAULT 'Bahasa Indonesia' NOT NULL,
	`ai_tone` text DEFAULT 'Conversational & Friendly' NOT NULL,
	`ai_prompt_template` text,
	`notify_on_failure` integer DEFAULT true NOT NULL,
	`notify_on_publish` integer DEFAULT false NOT NULL,
	`notify_on_cron_miss` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `video_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`duration_sec` integer,
	`size_bytes` integer,
	`mime` text,
	`brief` text,
	`content_type` text,
	`market` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "video_assets_status" CHECK("video_assets"."status" IN ('draft','queued','scheduled','published','failed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_assets_r2_key_unique` ON `video_assets` (`r2_key`);--> statement-breakpoint
CREATE INDEX `video_assets_channel_status` ON `video_assets` (`channel_id`,`status`);--> statement-breakpoint
CREATE TABLE `video_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`title_selected` text,
	`titles_json` text,
	`description` text,
	`tags_json` text,
	`first_comment` text,
	`thumbnail_text` text,
	`thumbnail_r2_key` text,
	`validation_status` text,
	`validation_json` text,
	`regenerate_count` integer DEFAULT 0 NOT NULL,
	`generated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `video_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_metadata_video_id_unique` ON `video_metadata` (`video_id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`event_type` text,
	`payload_json` text,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL
);

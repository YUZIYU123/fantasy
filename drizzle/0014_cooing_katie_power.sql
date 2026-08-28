CREATE TABLE `chapter_version_completion_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`chapter_version` integer NOT NULL,
	`completed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_version_completion_facts_user_chapter_version_unique` ON `chapter_version_completion_facts` (`user_id`,`chapter_id`,`chapter_version`);--> statement-breakpoint
CREATE INDEX `chapter_version_completion_facts_user_time_idx` ON `chapter_version_completion_facts` (`user_id`,`completed_at`);--> statement-breakpoint
ALTER TABLE `companion_profiles` ADD `commit_token` text DEFAULT '' NOT NULL;
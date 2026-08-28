DROP INDEX `chapter_version_completion_facts_user_time_idx`;--> statement-breakpoint
ALTER TABLE `chapter_version_completion_facts` ADD `recorded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
CREATE INDEX `chapter_version_completion_facts_user_time_idx` ON `chapter_version_completion_facts` (`user_id`,`recorded_at`);
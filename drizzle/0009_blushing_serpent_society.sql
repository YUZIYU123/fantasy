CREATE TABLE `chapter_completion_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`chapter_version` integer DEFAULT 0 NOT NULL,
	`completed_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_completion_records_user_chapter_unique` ON `chapter_completion_records` (`user_id`,`chapter_id`);--> statement-breakpoint
CREATE INDEX `chapter_completion_records_user_time_idx` ON `chapter_completion_records` (`user_id`,`completed_at`);--> statement-breakpoint
INSERT INTO `chapter_completion_records`
  (`id`, `user_id`, `chapter_id`, `chapter_version`, `completed_at`, `updated_at`)
SELECT progress.`id`, progress.`user_id`, progress.`chapter_id`, progress.`chapter_version`, progress.`completed_at`, progress.`updated_at`
FROM `reading_progress` progress
JOIN `users` account ON account.`id` = progress.`user_id`
JOIN `chapters` chapter ON chapter.`id` = progress.`chapter_id`
WHERE progress.`completed_at` IS NOT NULL;--> statement-breakpoint
DELETE FROM `reading_progress` WHERE `completed_at` IS NOT NULL;--> statement-breakpoint
DELETE FROM `reading_progress`
WHERE `user_id` NOT IN (SELECT `id` FROM `users`)
   OR `chapter_id` NOT IN (SELECT `id` FROM `chapters`);--> statement-breakpoint
ALTER TABLE `reading_progress` DROP COLUMN `completed_at`;

CREATE TABLE `bookshelf_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`novel_id` text NOT NULL,
	`public_snapshot_json` text DEFAULT '{}' NOT NULL,
	`added_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookshelf_entries_user_novel_unique` ON `bookshelf_entries` (`user_id`,`novel_id`);--> statement-breakpoint
CREATE INDEX `bookshelf_entries_user_added_idx` ON `bookshelf_entries` (`user_id`,`added_at`);--> statement-breakpoint
CREATE TABLE `novel_completion_frontiers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`novel_id` text NOT NULL,
	`chapter_ids_json` text DEFAULT '[]' NOT NULL,
	`completed_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `novel_completion_frontiers_user_novel_unique` ON `novel_completion_frontiers` (`user_id`,`novel_id`);
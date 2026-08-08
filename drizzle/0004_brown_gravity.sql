CREATE TABLE `novel_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`novel_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `novel_versions_novel_version_unique` ON `novel_versions` (`novel_id`,`version`);--> statement-breakpoint
CREATE TABLE `novels` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`owner_id` text,
	`draft_status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` text,
	`review_note` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`draft_json` text NOT NULL,
	`published_json` text,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `novels_slug_unique` ON `novels` (`slug`);--> statement-breakpoint
CREATE INDEX `novels_owner_status_idx` ON `novels` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `novels_status_sort_idx` ON `novels` (`status`,`sort_order`);--> statement-breakpoint
ALTER TABLE `chapters` ADD `novel_id` text DEFAULT 'legacy-global' NOT NULL;--> statement-breakpoint
CREATE INDEX `chapters_novel_status_sort_idx` ON `chapters` (`novel_id`,`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `chapters_owner_novel_idx` ON `chapters` (`owner_id`,`novel_id`);
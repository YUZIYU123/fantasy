CREATE TABLE `asset_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `assets` ADD `storage_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `folder_id` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `duration` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;
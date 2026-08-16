CREATE TABLE `bookshelf_operation_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`action` text NOT NULL,
	`novel_id` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookshelf_operation_receipts_user_operation_unique` ON `bookshelf_operation_receipts` (`user_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `bookshelf_operation_receipts_expiry_idx` ON `bookshelf_operation_receipts` (`expires_at`);--> statement-breakpoint
CREATE TABLE `bookshelf_rate_limit_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bookshelf_rate_limit_attempts_user_time_idx` ON `bookshelf_rate_limit_attempts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bookshelf_rate_limit_attempts_source_time_idx` ON `bookshelf_rate_limit_attempts` (`source_key`,`created_at`);
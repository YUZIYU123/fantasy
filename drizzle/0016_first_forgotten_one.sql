CREATE TABLE `companion_activity_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`activity_date` text NOT NULL,
	`chapter_id` text NOT NULL,
	`chapter_version` integer NOT NULL,
	`seconds` integer NOT NULL,
	`operation_id` text NOT NULL,
	`recorded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companion_activity_windows_user_operation_unique` ON `companion_activity_windows` (`user_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `companion_activity_windows_user_date_idx` ON `companion_activity_windows` (`user_id`,`activity_date`);--> statement-breakpoint
CREATE TABLE `companion_discoveries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`chapter_version` integer NOT NULL,
	`node_id` text NOT NULL,
	`recorded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companion_discoveries_route_unique` ON `companion_discoveries` (`user_id`,`chapter_id`,`chapter_version`,`node_id`);--> statement-breakpoint
CREATE INDEX `companion_discoveries_user_time_idx` ON `companion_discoveries` (`user_id`,`recorded_at`);
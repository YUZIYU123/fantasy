CREATE TABLE `account_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`registration_analytics_allowed` integer DEFAULT false NOT NULL,
	`reading_preferences_json` text DEFAULT '[]' NOT NULL,
	`guide_completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

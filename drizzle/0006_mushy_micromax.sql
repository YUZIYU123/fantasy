CREATE TABLE `registration_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`age_confirmed_at` text NOT NULL,
	`terms_version` text NOT NULL,
	`privacy_version` text NOT NULL,
	`confirmed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_consents_user_unique` ON `registration_consents` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `last_verification_sent_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `pending_expires_at` text;
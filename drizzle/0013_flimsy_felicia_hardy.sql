CREATE TABLE `companion_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`bond_xp` integer DEFAULT 0 NOT NULL,
	`vitality` integer DEFAULT 100 NOT NULL,
	`mistlight` integer DEFAULT 0 NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_touch_at` text,
	`last_rest_at` text,
	`reward_baseline_at` text,
	`equipped_appearance` text DEFAULT 'default' NOT NULL,
	`equipped_garden` text DEFAULT 'world-tree' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `companion_reward_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`receipt_key` text NOT NULL,
	`kind` text NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companion_reward_receipts_user_key_unique` ON `companion_reward_receipts` (`user_id`,`receipt_key`);--> statement-breakpoint
CREATE INDEX `companion_reward_receipts_user_time_idx` ON `companion_reward_receipts` (`user_id`,`created_at`);
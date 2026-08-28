CREATE TABLE `companion_inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`item_id` text NOT NULL,
	`unlocked_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companion_inventory_user_item_unique` ON `companion_inventory` (`user_id`,`type`,`item_id`);--> statement-breakpoint
CREATE INDEX `companion_inventory_user_type_idx` ON `companion_inventory` (`user_id`,`type`);
CREATE TABLE `account_operation_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_hash` text NOT NULL,
	`kind` text NOT NULL,
	`user_id` text,
	`status` text NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_operation_receipts_idempotency_unique` ON `account_operation_receipts` (`idempotency_hash`);--> statement-breakpoint
CREATE INDEX `account_operation_receipts_expiry_idx` ON `account_operation_receipts` (`expires_at`);
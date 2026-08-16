CREATE TABLE `bookshelf_list_snapshot_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`user_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`entry_ids_json` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookshelf_list_snapshot_chunks_snapshot_chunk_unique` ON `bookshelf_list_snapshot_chunks` (`snapshot_id`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `bookshelf_list_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`total` integer NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bookshelf_list_snapshots_user_expiry_idx` ON `bookshelf_list_snapshots` (`user_id`,`expires_at`);
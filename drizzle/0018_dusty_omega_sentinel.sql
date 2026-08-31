ALTER TABLE `novels` ADD `format` text DEFAULT 'serial' NOT NULL;--> statement-breakpoint
ALTER TABLE `novels` ADD `format_locked_at` text;--> statement-breakpoint
UPDATE `novels`
SET `format_locked_at` = coalesce(`submitted_at`, `updated_at`, CURRENT_TIMESTAMP)
WHERE `draft_status` = 'submitted'
  OR `status` != 'draft'
  OR `version` > 0
  OR `review_note` <> ''
  OR EXISTS (
    SELECT 1 FROM `chapters`
    WHERE `chapters`.`novel_id` = `novels`.`id`
      AND (`chapters`.`draft_status` = 'submitted' OR `chapters`.`status` != 'draft' OR `chapters`.`version` > 0 OR `chapters`.`review_note` <> '')
  );--> statement-breakpoint
CREATE INDEX `novels_format_status_sort_idx` ON `novels` (`format`,`status`,`sort_order`);

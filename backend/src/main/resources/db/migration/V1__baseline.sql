-- V1__baseline.sql  ·  VTC In-House Portal v2 (MySQL 8.0+)
-- GENERATED from the final v1.6 SQLite schema (SCHEMA + SCHEMA_V2 + every MIGRATIONS column), one table per CREATE.
-- Verified: this file runs cleanly on MySQL 8.0.46. Do not hand-edit column names: they match the v1.6 code and data.
-- Types: money = BIGINT paise · kg = DECIMAL(14,3) · *_at = DATETIME(6) in UTC · business dates = DATE (IST day) · flags = TINYINT(1)
-- `key` is a MySQL reserved word: every identifier is back-quoted; JPA must quote it (see 03_DATA_MODEL.md).
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
CREATE TABLE `meta` (
  `key` VARCHAR(191) NOT NULL,
  `value` TEXT NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `roles` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(191) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `tier` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL DEFAULT (''),
  `is_system` TINYINT(1) NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_key` (`key`),
  CONSTRAINT `ck_roles_1` CHECK (tier IN ('admin','manager','staff'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `role_permissions` (
  `role_id` BIGINT NOT NULL,
  `perm_key` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`role_id`, `perm_key`),
  FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `users` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(191) NOT NULL,
  `full_name` VARCHAR(255) NOT NULL,
  `role_id` BIGINT NOT NULL,
  `login_type` VARCHAR(255) NOT NULL,
  `secret_hash` VARCHAR(255) NOT NULL,
  `is_owner` TINYINT(1) NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `failed_attempts` INT NOT NULL DEFAULT 0,
  `locked_until` DATETIME(6),
  `must_change_secret` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  `reports_to` BIGINT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  CONSTRAINT `ck_users_1` CHECK (login_type IN ('password','pin')),
  FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_grants` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `perm_key` VARCHAR(255) NOT NULL,
  `effect` VARCHAR(255) NOT NULL,
  `reason` TEXT NOT NULL,
  `expires_at` DATETIME(6),
  `granted_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `revoked_at` DATETIME(6),
  `revoked_by` BIGINT,
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_user_grants_1` CHECK (effect IN ('allow','deny')),
  FOREIGN KEY (`revoked_by`) REFERENCES `users` (`id`),
  FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `sessions` (
  `token_hash` VARCHAR(191) NOT NULL,
  `user_id` BIGINT NOT NULL,
  `device_mode` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `last_seen` DATETIME(6) NOT NULL,
  `expires_at` DATETIME(6) NOT NULL,
  `insights_until` DATETIME(6),
  `user_agent` VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`token_hash`),
  CONSTRAINT `ck_sessions_1` CHECK (device_mode IN ('shared','personal')),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `settings` (
  `key` VARCHAR(191) NOT NULL,
  `value` TEXT NOT NULL,
  `changed_by` BIGINT,
  `changed_at` DATETIME(6),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `i18n_overrides` (
  `lang` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `text` TEXT NOT NULL,
  `changed_by` BIGINT,
  `changed_at` DATETIME(6),
  PRIMARY KEY (`lang`, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `dashboard_prefs` (
  `user_id` BIGINT NOT NULL,
  `widgets` TEXT NOT NULL,
  `shortcuts` TEXT NOT NULL,
  `welcome` TEXT NOT NULL DEFAULT (''),
  `lang` VARCHAR(255) NOT NULL DEFAULT 'en',
  `large_text` TINYINT(1) NOT NULL DEFAULT 0,
  `sizes` TEXT NOT NULL DEFAULT ('{}'),
  `voice_rate` DECIMAL(4,2) NOT NULL DEFAULT 0.95,
  PRIMARY KEY (`user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `role_dashboard_defaults` (
  `role_id` BIGINT NOT NULL,
  `widgets` TEXT NOT NULL,
  `shortcuts` TEXT NOT NULL,
  PRIMARY KEY (`role_id`),
  FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `masters` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `kind` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `nominal_kg` DECIMAL(14,3),
  `state` VARCHAR(255) NOT NULL,
  `creator_id` BIGINT NOT NULL,
  `approved_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  `phone` VARCHAR(255) NOT NULL DEFAULT '',
  `address` TEXT NOT NULL DEFAULT (''),
  `category` VARCHAR(255) NOT NULL DEFAULT '',
  `code` VARCHAR(191),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `receipts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `source` VARCHAR(255) NOT NULL,
  `source_name` VARCHAR(255) NOT NULL,
  `product_id` BIGINT NOT NULL,
  `bags` INT NOT NULL,
  `damaged` INT NOT NULL,
  `nominal_kg` DECIMAL(14,3) NOT NULL,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `invoice_ref` VARCHAR(255),
  `invoice_status` VARCHAR(255) NOT NULL DEFAULT 'PENDING',
  `payment_status` VARCHAR(255) NOT NULL DEFAULT 'PENDING',
  `payment_date` DATE,
  `invoice_amount_paise` BIGINT,
  `invoice_file_id` BIGINT,
  `reversed_at` DATETIME(6),
  `partial` TINYINT(1) NOT NULL DEFAULT 0,
  `partial_kg` DECIMAL(14,3),
  `code` VARCHAR(191),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`product_id`) REFERENCES `masters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `lots` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT,
  `name` VARCHAR(255) NOT NULL,
  `stage` VARCHAR(255) NOT NULL,
  `owner` VARCHAR(255) NOT NULL DEFAULT 'VTC',
  `status` VARCHAR(255) NOT NULL,
  `receipt_id` BIGINT,
  `roast_id` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  `location` VARCHAR(255) NOT NULL DEFAULT 'PROD-01',
  `customer_id` BIGINT,
  `pack_g` DECIMAL(10,3),
  `form` VARCHAR(255),
  `bag_kind` VARCHAR(255),
  `bags` INT,
  `bean_id` BIGINT,
  `code` VARCHAR(191),
  `roasted_on` DATE,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`receipt_id`) REFERENCES `receipts` (`id`),
  FOREIGN KEY (`product_id`) REFERENCES `masters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `movements` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `lot_id` BIGINT NOT NULL,
  `delta_kg` DECIMAL(14,3) NOT NULL,
  `action` VARCHAR(255) NOT NULL,
  `source_id` BIGINT,
  `actor_id` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`lot_id`) REFERENCES `lots` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `roast_batches` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `output_lot_id` BIGINT,
  `input_kg` DECIMAL(14,3) NOT NULL,
  `output_kg` DECIMAL(14,3) NOT NULL,
  `loss_kg` DECIMAL(14,3) NOT NULL,
  `duration_min` INT NOT NULL,
  `profile` VARCHAR(255),
  `notes` TEXT,
  `abnormal` TINYINT(1) NOT NULL,
  `qc_status` VARCHAR(255) NOT NULL,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `profile_id` BIGINT,
  `code` VARCHAR(191),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `roast_inputs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT 'v2 surrogate key (SQLite table had no primary key)',
  `roast_id` BIGINT NOT NULL,
  `lot_id` BIGINT NOT NULL,
  `kg` DECIMAL(14,3) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`lot_id`) REFERENCES `lots` (`id`),
  FOREIGN KEY (`roast_id`) REFERENCES `roast_batches` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `qc_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `roast_id` BIGINT NOT NULL,
  `decision` VARCHAR(255) NOT NULL,
  `note` TEXT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`roast_id`) REFERENCES `roast_batches` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tasks` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NOT NULL,
  `assigned_to` BIGINT,
  `target` DECIMAL(14,3),
  `progress` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `status` VARCHAR(255) NOT NULL DEFAULT 'OPEN',
  `due` DATE,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `kind` VARCHAR(255) NOT NULL DEFAULT 'GENERAL',
  `ref_id` BIGINT,
  `submitted_at` DATETIME(6),
  `submit_note` TEXT NOT NULL DEFAULT (''),
  `reviewed_by` BIGINT,
  `reviewed_at` DATETIME(6),
  `review_note` TEXT NOT NULL DEFAULT (''),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `pack_jobs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_name` VARCHAR(255) NOT NULL,
  `demand_type` VARCHAR(255) NOT NULL,
  `packs_target` INT NOT NULL,
  `pack_g` DECIMAL(10,3) NOT NULL,
  `packs_done` INT NOT NULL DEFAULT 0,
  `state` VARCHAR(255) NOT NULL DEFAULT 'DRAFT',
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `source_lot_id` BIGINT,
  `input_kg` DECIMAL(14,3),
  `rejected_packs` INT NOT NULL DEFAULT 0,
  `output_lot_id` BIGINT,
  `label_ref` VARCHAR(255) NOT NULL DEFAULT '',
  `order_id` BIGINT,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `orders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `customer_id` BIGINT NOT NULL,
  `item` VARCHAR(255) NOT NULL,
  `quantity_kg` DECIMAL(14,3) NOT NULL,
  `credit_requested` TINYINT(1) NOT NULL,
  `state` VARCHAR(255) NOT NULL DEFAULT 'DRAFT',
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `form` VARCHAR(255) NOT NULL DEFAULT 'ROASTED',
  `price_per_kg_paise` BIGINT,
  `credit_decided_by` BIGINT,
  `credit_note` TEXT NOT NULL DEFAULT (''),
  `dispatched_kg` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `invoice_id` BIGINT,
  `notes` TEXT NOT NULL DEFAULT (''),
  `product_id` BIGINT,
  `gst_rate_bp` INT,
  `advance_paise` BIGINT NOT NULL DEFAULT 0,
  `advance_ref` VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`customer_id`) REFERENCES `masters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `config` (
  `key` VARCHAR(191) NOT NULL,
  `value` TEXT NOT NULL,
  `changed_by` BIGINT,
  `changed_at` DATETIME(6),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `audit` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT,
  `category` VARCHAR(191) NOT NULL DEFAULT 'operations',
  `action` VARCHAR(255) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `info` TEXT NOT NULL DEFAULT (''),
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `idem` (
  `user_id` BIGINT NOT NULL,
  `operation` VARCHAR(191) NOT NULL,
  `idem_key` VARCHAR(191) NOT NULL,
  `result` TEXT NOT NULL,
  PRIMARY KEY (`user_id`, `operation`, `idem_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `reservations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `lot_id` BIGINT NOT NULL,
  `kg` DECIMAL(14,3) NOT NULL,
  `state` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`lot_id`) REFERENCES `lots` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `transfers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `from_loc` VARCHAR(255) NOT NULL,
  `to_loc` VARCHAR(255) NOT NULL,
  `source_lot_id` BIGINT NOT NULL,
  `transit_lot_id` BIGINT,
  `dest_lot_id` BIGINT,
  `kg_sent` DECIMAL(14,3) NOT NULL,
  `kg_received` DECIMAL(14,3),
  `state` VARCHAR(255) NOT NULL,
  `note` TEXT NOT NULL DEFAULT (''),
  `sent_by` BIGINT NOT NULL,
  `received_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  `received_at` DATETIME(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cycle_counts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `lot_id` BIGINT NOT NULL,
  `book_kg` DECIMAL(14,3) NOT NULL,
  `counted_kg` DECIMAL(14,3) NOT NULL,
  `variance_kg` DECIMAL(14,3) NOT NULL,
  `note` TEXT NOT NULL DEFAULT (''),
  `state` VARCHAR(255) NOT NULL,
  `counted_by` BIGINT NOT NULL,
  `decided_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  `decided_at` DATETIME(6),
  `kind` VARCHAR(255) NOT NULL DEFAULT 'COUNT',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `teams` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(191) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_teams_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_teams` (
  `user_id` BIGINT NOT NULL,
  `team_id` BIGINT NOT NULL,
  PRIMARY KEY (`user_id`, `team_id`),
  FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `conversations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `kind` VARCHAR(255) NOT NULL,
  `title` VARCHAR(255) NOT NULL DEFAULT '',
  `team_id` BIGINT,
  `record_type` VARCHAR(255),
  `record_id` BIGINT,
  `created_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `conversation_members` (
  `conversation_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `last_read_id` BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`conversation_id`, `user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `messages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `conversation_id` BIGINT NOT NULL,
  `author_id` BIGINT,
  `body` TEXT NOT NULL DEFAULT (''),
  `voice_file_id` BIGINT,
  `audience` VARCHAR(255),
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`author_id`) REFERENCES `users` (`id`),
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `announcement_reads` (
  `message_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `read_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`message_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `files` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `kind` VARCHAR(255) NOT NULL,
  `mime` VARCHAR(255) NOT NULL,
  `bytes` BIGINT NOT NULL,
  `sha256` VARCHAR(255) NOT NULL,
  `path` VARCHAR(255) NOT NULL,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `expires_at` DATETIME(6),
  `deleted_at` DATETIME(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `alerts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `severity` VARCHAR(255) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL DEFAULT (''),
  `view` VARCHAR(255),
  `record_type` VARCHAR(255),
  `record_id` BIGINT,
  `dedupe_key` VARCHAR(255),
  `created_at` DATETIME(6) NOT NULL,
  `visible_at` DATETIME(6) NOT NULL,
  `read_at` DATETIME(6),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `counter_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `coffee_pct` DECIMAL(7,3) NOT NULL DEFAULT 0,
  `chicory_product_id` BIGINT,
  `stock_product_id` BIGINT,
  `price_per_kg_paise` BIGINT NOT NULL,
  `gst_rate_bp` INT,
  `hsn` VARCHAR(255) NOT NULL DEFAULT '',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `version` INT NOT NULL DEFAULT 1,
  `changed_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `counter_sales` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `bill_no` VARCHAR(191) NOT NULL,
  `customer_name` VARCHAR(255) NOT NULL DEFAULT '',
  `customer_phone` VARCHAR(255) NOT NULL DEFAULT '',
  `subtotal_paise` BIGINT NOT NULL,
  `discount_paise` BIGINT NOT NULL DEFAULT 0,
  `discount_reason` VARCHAR(255) NOT NULL DEFAULT '',
  `gst_paise` BIGINT NOT NULL DEFAULT 0,
  `total_paise` BIGINT NOT NULL,
  `status` VARCHAR(255) NOT NULL,
  `reprints` INT NOT NULL DEFAULT 0,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `customer_id` BIGINT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_counter_sales_bill_no` (`bill_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `counter_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `sale_id` BIGINT NOT NULL,
  `item_id` BIGINT NOT NULL,
  `item_name` VARCHAR(255) NOT NULL,
  `weight_kg` DECIMAL(14,3) NOT NULL,
  `rate_paise` BIGINT NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `gst_rate_bp` INT,
  `coffee_pct` DECIMAL(7,3),
  `override_reason` VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  FOREIGN KEY (`sale_id`) REFERENCES `counter_sales` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `counter_payments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `sale_id` BIGINT NOT NULL,
  `method` VARCHAR(255) NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `reference` VARCHAR(255) NOT NULL DEFAULT '',
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`sale_id`) REFERENCES `counter_sales` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `counter_refunds` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `sale_id` BIGINT NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `method` VARCHAR(255) NOT NULL,
  `reason` TEXT NOT NULL,
  `state` VARCHAR(255) NOT NULL,
  `requested_by` BIGINT NOT NULL,
  `decided_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  `decided_at` DATETIME(6),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`sale_id`) REFERENCES `counter_sales` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cash_closes` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shift_date` DATE NOT NULL,
  `opening_paise` BIGINT NOT NULL,
  `cash_sales_paise` BIGINT NOT NULL,
  `cash_refunds_paise` BIGINT NOT NULL,
  `expected_paise` BIGINT NOT NULL,
  `counted_paise` BIGINT NOT NULL,
  `difference_paise` BIGINT NOT NULL,
  `note` TEXT NOT NULL DEFAULT (''),
  `state` VARCHAR(255) NOT NULL,
  `submitted_by` BIGINT NOT NULL,
  `decided_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  `decided_at` DATETIME(6),
  `bills` INT,
  `total_paise` BIGINT,
  `register` TEXT,
  `reopened_by` BIGINT,
  `reopened_at` DATETIME(6),
  `reopen_reason` TEXT NOT NULL DEFAULT (''),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `recipes` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `confidential` TINYINT(1) NOT NULL DEFAULT 0,
  `stage` VARCHAR(255) NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `recipe_versions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `recipe_id` BIGINT NOT NULL,
  `version` INT NOT NULL,
  `components` TEXT NOT NULL,
  `notes` TEXT NOT NULL DEFAULT (''),
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`recipe_id`) REFERENCES `recipes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `blend_jobs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `recipe_version_id` BIGINT NOT NULL,
  `stage` VARCHAR(255) NOT NULL,
  `input_kg` DECIMAL(14,3) NOT NULL,
  `output_kg` DECIMAL(14,3) NOT NULL,
  `loss_kg` DECIMAL(14,3) NOT NULL,
  `output_lot_id` BIGINT,
  `notes` TEXT NOT NULL DEFAULT (''),
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `blend_inputs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT 'v2 surrogate key (SQLite table had no primary key)',
  `job_id` BIGINT NOT NULL,
  `lot_id` BIGINT NOT NULL,
  `kg` DECIMAL(14,3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `grind_jobs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `input_lot_id` BIGINT NOT NULL,
  `input_kg` DECIMAL(14,3) NOT NULL,
  `output_kg` DECIMAL(14,3) NOT NULL,
  `grind` VARCHAR(255) NOT NULL,
  `output_lot_id` BIGINT,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `outside_jobs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `customer_id` BIGINT NOT NULL,
  `received_kg` DECIMAL(14,3) NOT NULL,
  `raw_lot_id` BIGINT NOT NULL,
  `input_kg` DECIMAL(14,3),
  `output_kg` DECIMAL(14,3),
  `loss_kg` DECIMAL(14,3),
  `roasted_lot_id` BIGINT,
  `charge_basis` VARCHAR(255) NOT NULL,
  `rate_paise` BIGINT NOT NULL,
  `charge_paise` BIGINT,
  `returned_kg` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `return_note` TEXT NOT NULL DEFAULT (''),
  `payment_status` VARCHAR(255) NOT NULL DEFAULT 'PENDING',
  `state` VARCHAR(255) NOT NULL,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `bean_type` VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `customer_terms` (
  `customer_id` BIGINT NOT NULL,
  `credit_limit_paise` BIGINT NOT NULL,
  `due_days` INT NOT NULL,
  `set_by` BIGINT NOT NULL,
  `set_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `dispatches` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `mode` VARCHAR(255) NOT NULL,
  `booking_ref` VARCHAR(255) NOT NULL DEFAULT '',
  `handover_to` VARCHAR(255) NOT NULL,
  `evidence` TEXT NOT NULL DEFAULT (''),
  `kg` DECIMAL(14,3) NOT NULL,
  `handed_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `delivered_kg` DECIMAL(14,3),
  `pod_note` TEXT,
  `delivered_at` DATETIME(6),
  `confirmed_by` BIGINT,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `invoices` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `number` VARCHAR(191) NOT NULL,
  `order_id` BIGINT NOT NULL,
  `customer_id` BIGINT NOT NULL,
  `taxable_paise` BIGINT NOT NULL,
  `gst_paise` BIGINT NOT NULL,
  `total_paise` BIGINT NOT NULL,
  `due_date` DATE NOT NULL,
  `status` VARCHAR(255) NOT NULL,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoices_number` (`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `collections` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `invoice_id` BIGINT NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `method` VARCHAR(255) NOT NULL,
  `reference` VARCHAR(255) NOT NULL DEFAULT '',
  `state` VARCHAR(255) NOT NULL,
  `recorded_by` BIGINT NOT NULL,
  `verified_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  `verified_at` DATETIME(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `supplier_payments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `receipt_id` BIGINT NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `reference` VARCHAR(255) NOT NULL DEFAULT '',
  `paid_on` DATE NOT NULL,
  `state` VARCHAR(255) NOT NULL,
  `recorded_by` BIGINT NOT NULL,
  `approved_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  `decided_at` DATETIME(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tally_exports` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `batch_no` VARCHAR(191) NOT NULL,
  `period_from` DATE NOT NULL,
  `period_to` DATE NOT NULL,
  `voucher_count` INT NOT NULL,
  `control_total_paise` BIGINT NOT NULL,
  `checksum` VARCHAR(255) NOT NULL,
  `content` TEXT NOT NULL,
  `state` VARCHAR(255) NOT NULL,
  `result_note` TEXT NOT NULL DEFAULT (''),
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `decided_by` BIGINT,
  `decided_at` DATETIME(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tally_exports_batch_no` (`batch_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tally_export_lines` (
  `export_id` BIGINT NOT NULL,
  `source_type` VARCHAR(191) NOT NULL,
  `source_id` BIGINT NOT NULL,
  PRIMARY KEY (`export_id`, `source_type`, `source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `roast_profiles` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `notes` TEXT NOT NULL DEFAULT (''),
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `counter_customers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `phone` VARCHAR(191) NOT NULL,
  `name` VARCHAR(255) NOT NULL DEFAULT '',
  `visits` INT NOT NULL DEFAULT 0,
  `first_seen` DATETIME(6) NOT NULL,
  `last_seen` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_counter_customers_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `counter_collections` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `day` DATE NOT NULL,
  `method` VARCHAR(255) NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `note` TEXT NOT NULL DEFAULT (''),
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `secrets` (
  `key` VARCHAR(191) NOT NULL,
  `value` TEXT NOT NULL,
  `changed_by` BIGINT,
  `changed_at` DATETIME(6),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `roast_meter` (
  `month` CHAR(7) NOT NULL,
  `start_reading` INT,
  `end_reading` INT,
  `updated_by` BIGINT,
  `updated_at` DATETIME(6),
  PRIMARY KEY (`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `gas_cylinders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `fitted_on` DATE NOT NULL,
  `kg` DECIMAL(14,3) NOT NULL,
  `note` TEXT NOT NULL DEFAULT (''),
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `maintenance` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NOT NULL,
  `area` VARCHAR(255) NOT NULL,
  `details` TEXT NOT NULL DEFAULT (''),
  `urgency` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'OPEN',
  `raised_by` BIGINT NOT NULL,
  `assigned_to` BIGINT,
  `resolution` TEXT NOT NULL DEFAULT (''),
  `resolved_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `stock_cards` (
  `product_id` BIGINT NOT NULL,
  `label` VARCHAR(255) NOT NULL DEFAULT '',
  `color` VARCHAR(255) NOT NULL DEFAULT '',
  `sort` INT NOT NULL DEFAULT 0,
  `hidden` TINYINT(1) NOT NULL DEFAULT 0,
  `pinned` TINYINT(1) NOT NULL DEFAULT 0,
  `low_kg` DECIMAL(14,3),
  `updated_by` BIGINT,
  `updated_at` DATETIME(6),
  `low_alerted` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `stock_dirty` (
  `id` BIGINT NOT NULL,
  `dirty` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_stock_dirty_1` CHECK (id=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `staff_profiles` (
  `user_id` BIGINT NOT NULL,
  `designation` VARCHAR(255) NOT NULL DEFAULT '',
  `phone` VARCHAR(255) NOT NULL DEFAULT '',
  `alt_phone` VARCHAR(255) NOT NULL DEFAULT '',
  `email` VARCHAR(255) NOT NULL DEFAULT '',
  `address` TEXT NOT NULL DEFAULT (''),
  `dob` DATE,
  `joined_on` DATE,
  `emergency_name` VARCHAR(255) NOT NULL DEFAULT '',
  `emergency_phone` VARCHAR(255) NOT NULL DEFAULT '',
  `aadhaar_last4` VARCHAR(255) NOT NULL DEFAULT '',
  `pan_last4` VARCHAR(255) NOT NULL DEFAULT '',
  `bank_name` VARCHAR(255) NOT NULL DEFAULT '',
  `bank_last4` VARCHAR(255) NOT NULL DEFAULT '',
  `ifsc` VARCHAR(255) NOT NULL DEFAULT '',
  `notes` TEXT NOT NULL DEFAULT (''),
  `updated_by` BIGINT,
  `updated_at` DATETIME(6),
  PRIMARY KEY (`user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `golive` (
  `id` BIGINT NOT NULL,
  `state` VARCHAR(255) NOT NULL DEFAULT 'SETUP',
  `cash_paise` BIGINT,
  `confirmed_by` BIGINT,
  `confirmed_at` DATETIME(6),
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_golive_1` CHECK (id=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `opening_stock` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `form` VARCHAR(255) NOT NULL,
  `bag_kind` VARCHAR(255),
  `bags` INT,
  `kg` DECIMAL(14,3) NOT NULL,
  `location` VARCHAR(255) NOT NULL,
  `roasted_on` DATE,
  `note` TEXT NOT NULL DEFAULT (''),
  `lot_id` BIGINT,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`product_id`) REFERENCES `masters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `opening_dues` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `side` VARCHAR(255) NOT NULL,
  `party_id` BIGINT NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `since` DATE,
  `due_date` DATE,
  `note` TEXT NOT NULL DEFAULT (''),
  `state` VARCHAR(255) NOT NULL DEFAULT 'DRAFT',
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_opening_dues_1` CHECK (side IN ('CLIENT','SUPPLIER','STAFF'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `opening_due_payments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `due_id` BIGINT NOT NULL,
  `amount_paise` BIGINT NOT NULL,
  `method` VARCHAR(255) NOT NULL,
  `reference` VARCHAR(255) NOT NULL DEFAULT '',
  `state` VARCHAR(255) NOT NULL,
  `recorded_by` BIGINT NOT NULL,
  `verified_by` BIGINT,
  `created_at` DATETIME(6) NOT NULL,
  `verified_at` DATETIME(6),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`due_id`) REFERENCES `opening_dues` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `staff_documents` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `label` VARCHAR(255) NOT NULL DEFAULT '',
  `file_id` BIGINT NOT NULL,
  `uploaded_by` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `removed_at` DATETIME(6),
  `removed_by` BIGINT,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`file_id`) REFERENCES `files` (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX `ix_grants_user` ON `user_grants` (`user_id`);
CREATE INDEX `ix_sessions_user` ON `sessions` (`user_id`);
-- SQLite: CREATE UNIQUE INDEX ux_bean_code ON masters(code) WHERE kind='product' AND code IS NOT NULL AND code!=''
ALTER TABLE `masters` ADD COLUMN `bean_code_key` VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN `kind`='product' AND `code` IS NOT NULL AND `code`<>'' THEN `code` END) STORED;
CREATE UNIQUE INDEX `ux_bean_code` ON `masters` (`bean_code_key`);
CREATE UNIQUE INDEX `ux_receipts_code` ON `receipts` (`code`);
CREATE UNIQUE INDEX `ux_lots_code` ON `lots` (`code`);
CREATE INDEX `ix_movements_lot` ON `movements` (`lot_id`);
CREATE UNIQUE INDEX `ux_roast_code` ON `roast_batches` (`code`);
CREATE INDEX `ix_audit_cat` ON `audit` (`category`, `id`);
CREATE INDEX `ix_res_lot` ON `reservations` (`lot_id`, `state`);
CREATE INDEX `ix_msg_conv` ON `messages` (`conversation_id`, `id`);
CREATE INDEX `ix_alerts_user` ON `alerts` (`user_id`, `read_at`);

-- SQLite trigger movements_mark_stock: AFTER INSERT ON movements -> UPDATE stock_dirty SET dirty=1 WHERE id=1
CREATE TRIGGER `movements_mark_stock` AFTER INSERT ON `movements` FOR EACH ROW UPDATE `stock_dirty` SET `dirty`=1 WHERE `id`=1;

SET FOREIGN_KEY_CHECKS = 1;

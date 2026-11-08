-- expect: sql.alter-column-type sql.rename-column sql.add-column-not-null-no-default sql.drop-index sql.drop-index sql.add-unique-or-foreign-key
ALTER TABLE `orders` MODIFY COLUMN `total` DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE `orders` CHANGE `qty` `quantity` INT NOT NULL DEFAULT 0;
ALTER TABLE `orders` ADD COLUMN `note` VARCHAR(20) NOT NULL;
ALTER TABLE `orders` DROP INDEX `idx_old`;
DROP INDEX `idx_x` ON `orders`;
ALTER TABLE `orders` ADD UNIQUE KEY `uq_ref` (`ref`);

-- expect: none
CREATE TABLE `events` (`id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;
# DROP TABLE `events`;
INSERT INTO `logs` (`msg`) VALUES ("DROP TABLE `events`; TRUNCATE logs;");
INSERT INTO `logs` (`msg`) VALUES ('escaped \' quote; DROP TABLE x');
ALTER TABLE `logs` ADD COLUMN `level` INT NULL;
ALTER TABLE `logs` ADD INDEX `idx_level` (`level`);

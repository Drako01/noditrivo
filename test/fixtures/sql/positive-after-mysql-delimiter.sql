-- expect: sql.drop-table
DELIMITER //
CREATE PROCEDURE cleanup() BEGIN DROP TABLE tmp_inside; DELETE FROM tmp; END//
DELIMITER ;
DROP TABLE `real_table`;

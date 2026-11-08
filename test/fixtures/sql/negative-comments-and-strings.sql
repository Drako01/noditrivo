-- expect: none
-- DROP TABLE users;
/* DROP TABLE legacy;
   TRUNCATE audit_log; */
INSERT INTO notes (body) VALUES ('DROP TABLE users; DELETE FROM x;');
INSERT INTO notes (body) VALUES ('it''s fine; DROP TABLE y');
COMMENT ON TABLE notes IS 'ALTER TABLE notes DROP COLUMN body';

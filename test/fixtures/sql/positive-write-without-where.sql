-- expect: sql.write-without-where sql.write-without-where
DELETE FROM sessions;
UPDATE users SET active = false;

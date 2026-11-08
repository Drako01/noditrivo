-- expect: none
UPDATE users SET active = false WHERE last_login < now() - interval '1 year';
DELETE FROM sessions WHERE expired = true;

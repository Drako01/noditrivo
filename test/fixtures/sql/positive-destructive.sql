-- expect: sql.drop-table sql.drop-column sql.truncate sql.drop-schema
DROP TABLE IF EXISTS public.legacy_users;
ALTER TABLE accounts DROP COLUMN IF EXISTS nickname;
TRUNCATE TABLE audit_log;
DROP SCHEMA old CASCADE;

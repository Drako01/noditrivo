-- expect: none
ALTER TABLE users ADD COLUMN bio text;
ALTER TABLE users ADD COLUMN plan text NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN seq bigserial NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_plan ON users (plan);
INSERT INTO plans (name) VALUES ('free'), ('pro');

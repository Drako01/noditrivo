-- expect: none
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_email ON users (email);
ALTER TABLE users ADD COLUMN plan text NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);

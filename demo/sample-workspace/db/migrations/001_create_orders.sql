CREATE TABLE orders (
  id bigint PRIMARY KEY,
  note text,
  total_cents integer NOT NULL
);

CREATE TABLE legacy_orders (
  id bigint PRIMARY KEY
);

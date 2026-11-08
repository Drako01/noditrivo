-- expect: sql.alter-column-type sql.set-not-null sql.add-column-not-null-no-default sql.add-unique-or-foreign-key sql.add-unique-or-foreign-key sql.drop-constraint sql.drop-index sql.create-index-blocking
ALTER TABLE orders ALTER COLUMN total TYPE numeric(12,2);
ALTER TABLE orders ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE orders ADD COLUMN status text NOT NULL;
ALTER TABLE orders ADD CONSTRAINT orders_ref_uniq UNIQUE (ref);
ALTER TABLE orders ADD CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id);
ALTER TABLE orders DROP CONSTRAINT orders_old_check;
DROP INDEX CONCURRENTLY idx_orders_old;
CREATE INDEX idx_orders_ref ON orders (ref);

-- expect: sql.rename-column sql.rename-table sql.rename-table
ALTER TABLE users RENAME COLUMN email TO email_address;
ALTER TABLE users RENAME TO members;
RENAME TABLE invoices TO invoices_old;

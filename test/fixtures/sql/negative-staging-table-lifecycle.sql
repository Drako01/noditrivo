-- expect: none
CREATE TABLE staging_import (id integer, payload text);
TRUNCATE staging_import;
ALTER TABLE staging_import ALTER COLUMN id SET NOT NULL;
DROP TABLE staging_import;

-- expect: sql.drop-table
CREATE FUNCTION purge() RETURNS void AS $$
BEGIN
  DELETE FROM tmp;
  DROP TABLE tmp_inside;
END;
$$ LANGUAGE plpgsql;
DROP TABLE real_table;

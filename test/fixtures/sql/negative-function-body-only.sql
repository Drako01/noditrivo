-- expect: none
CREATE OR REPLACE FUNCTION rotate() RETURNS void AS $body$
BEGIN
  DROP TABLE IF EXISTS scratch;
  TRUNCATE scratch_log;
  DELETE FROM scratch_log;
END;
$body$ LANGUAGE plpgsql;

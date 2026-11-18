-- Kontroll for 20261120_slaa_sammen_varer.del01av08 (bare SELECT). Forventet: lengde 12935 tegn, md5 f5b405ab367102afc884e30cbb631c1e.
select part, length(body) as tegn, md5(body) as md5, md5(body) = 'f5b405ab367102afc884e30cbb631c1e' as riktig from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 1;

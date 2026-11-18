-- Kontroll for 20261120_slaa_sammen_varer.del01av07 (bare SELECT). Forventet: lengde 12913 tegn, md5 e243c19959b8b8d712d377d9b4ed2e98.
select part, length(body) as tegn, md5(body) as md5, md5(body) = 'e243c19959b8b8d712d377d9b4ed2e98' as riktig from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 1;

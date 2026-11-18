-- Kontroll for 20261120_slaa_sammen_varer.del05av08 (bare SELECT). Forventet: lengde 12937 tegn, md5 328e40ac1258fd3ed04b6079aca0a4ae.
select part, length(body) as tegn, md5(body) as md5, md5(body) = '328e40ac1258fd3ed04b6079aca0a4ae' as riktig from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 5;

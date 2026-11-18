-- Kontroll for 20261120_slaa_sammen_varer.del02av07 (bare SELECT). Forventet: lengde 12792 tegn, md5 e2feb7079dc710126bc2d9d0180f35d9.
select part, length(body) as tegn, md5(body) as md5, md5(body) = 'e2feb7079dc710126bc2d9d0180f35d9' as riktig from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 2;

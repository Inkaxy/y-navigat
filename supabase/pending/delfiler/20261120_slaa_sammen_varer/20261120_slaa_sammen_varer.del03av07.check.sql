-- Kontroll for 20261120_slaa_sammen_varer.del03av07 (bare SELECT). Forventet: lengde 12939 tegn, md5 024e58e5d9b7ba5cc92484f04182bb22.
select part, length(body) as tegn, md5(body) as md5, md5(body) = '024e58e5d9b7ba5cc92484f04182bb22' as riktig from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 3;

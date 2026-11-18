-- Kontroll for 20261120_slaa_sammen_varer.del06av07 (bare SELECT). Forventet: lengde 12841 tegn, md5 49c0baceda8f751d9d4b3cdd4bbbdbf3.
select part, length(body) as tegn, md5(body) as md5, md5(body) = '49c0baceda8f751d9d4b3cdd4bbbdbf3' as riktig from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 6;

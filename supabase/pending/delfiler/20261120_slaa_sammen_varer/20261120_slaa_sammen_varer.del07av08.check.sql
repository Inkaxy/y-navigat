-- Kontroll for 20261120_slaa_sammen_varer.del07av08 (bare SELECT). Forventet: lengde 843 tegn, md5 ea854e8be23bd354b98c7f6144ecd51f.
select part, length(body) as tegn, md5(body) as md5, md5(body) = 'ea854e8be23bd354b98c7f6144ecd51f' as riktig from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 7;

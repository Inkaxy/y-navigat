-- Kontroll for 20261120_slaa_sammen_varer.del04av08 (bare SELECT). Forventet: lengde 12894 tegn, md5 8ab670c0bf53f07efdcf50acbe773489.
select part, length(body) as tegn, md5(body) as md5, md5(body) = '8ab670c0bf53f07efdcf50acbe773489' as riktig from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 4;

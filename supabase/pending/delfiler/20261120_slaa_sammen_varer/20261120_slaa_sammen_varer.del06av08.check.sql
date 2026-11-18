-- Kontroll for 20261120_slaa_sammen_varer.del06av08 (bare SELECT). Forventet: lengde 12955 tegn, md5 56a916303d903ef2cc3b2bead10ca7c7.
select part, length(body) as tegn, md5(body) as md5, md5(body) = '56a916303d903ef2cc3b2bead10ca7c7' as riktig from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 6;

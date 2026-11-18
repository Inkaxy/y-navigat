-- 00 – TEST AV INNLIMING. Ren SELECT: skriver ingenting, endrer ingenting, kan kjøres så ofte du vil.
-- Lim inn hele filen i Supabase › SQL Editor på samme måte som de andre filene og trykk Run.
-- Svaret er én rad. «resultat» = ok betyr at innlimingen er byte-identisk med filen.
--   har_cr   = true: linjeskiftene er blitt Windows-linjeskift (CR+LF).
--   har_nbsp = true: vanlige mellomrom er blitt harde mellomrom.
--   har_tab  = false: tabulatoren på linje 3 i teksten er blitt mellomrom.
--   lengde/md5 avviker fra forventet: noe annet er endret (f.eks. mellomrom foran en linje eller æøå).
-- «etter_rensing» = ok betyr at filene 01–07 likevel tåler denne innlimingen (de fjerner CR og gjør
-- harde mellomrom/tabulator om til mellomrom før de sammenligner tekst).
select strpos(t, chr(13)) > 0 as har_cr,
       strpos(t, chr(160)) > 0 as har_nbsp,
       strpos(t, chr(9)) > 0 as har_tab,
       length(t) as lengde,
       106 as forventet_lengde,
       md5(t) as md5,
       'e1042573c9f427f0c094900b80f517df' as forventet_md5,
       case when md5(t) = 'e1042573c9f427f0c094900b80f517df' then 'ok' else 'ikke ok' end as resultat,
       case when md5(replace(replace(replace(t, chr(13), ''), chr(160), ' '), chr(9), ' ')) = '592a841d9a4620b71deef1954c13bf51' then 'ok' else 'ikke ok' end as etter_rensing
from (select $x$Linje 1: Nøtterø Bakeri – æøå ÆØÅ
  to mellomrom foran
	tabulator foran
 k text; new_id uuid;
siste linje
$x$::text as t) s;

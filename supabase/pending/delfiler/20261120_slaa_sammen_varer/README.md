# 20261120_slaa_sammen_varer i åtte deler

Reserve for innskriving for hånd. Når filen limes inn i SQL Editor, brukes heller hele originalen
`../../1-kjor-na/05_slaa_sammen_varer.sql` (78 kB), og disse delene trengs ikke. Delene inneholder originalen ordrett
(laget på nytt 18.11 etter at originalen fikk sluttsteget for linjeskift). Hver del renser innlimt tekst for CR, hardt
mellomrom og tabulator før md5 sjekkes, så Windows-linjeskift gir ikke «skrevet inn feil».

1. Kjør `del01av08.PENDING.sql` … `del07av08.PENDING.sql` i rekkefølge. Hver del legger bare sin tekst i en
   mellomlagringstabell og stopper med feilmelding hvis md5 avviker (skrivefeil) eller forrige del mangler.
   Delene kan kjøres på nytt. Etter hver del kan tilhørende `.check.sql` kjøres (forventet `riktig = true`).
2. Kjør `del08av08.PENDING.sql` («kjør»). Den kontrollerer alle delene og md5 for hele teksten, kjører den i
   én transaksjon og fjerner mellomlagringen. Feiler noe, rulles alt tilbake.
3. Kjør `del08av08.check.sql` (md5 av funksjonskroppene) og `../../kontroll/20261120_slaa_sammen_varer.check.sql`.

Delene lages med `node scripts/splitPendingSql.mjs <fil>`; `src/test/splitPendingSql.test.ts` kontrollerer
at delene på disk er like verktøyets utdata, at de satt sammen er originalen, og at kjøring gir samme funksjoner.

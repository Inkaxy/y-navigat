# 20261120_slaa_sammen_varer i sju deler

Erstatter innskriving av den store filen `../20261120_slaa_sammen_varer.PENDING.sql` (77 kB). Originalen er
uendret og er den gjennomgåtte teksten; delene inneholder den ordrett.

1. Kjør `del01av07.PENDING.sql` … `del06av07.PENDING.sql` i rekkefølge. Hver del legger bare sin tekst i en
   mellomlagringstabell og stopper med feilmelding hvis md5 avviker (skrivefeil) eller forrige del mangler.
   Delene kan kjøres på nytt. Etter hver del kan tilhørende `.check.sql` kjøres (forventet `riktig = true`).
2. Kjør `del07av07.PENDING.sql` («kjør»). Den kontrollerer alle delene og md5 for hele teksten, kjører den i
   én transaksjon og fjerner mellomlagringen. Feiler noe, rulles alt tilbake.
3. Kjør `del07av07.check.sql` (md5 av funksjonskroppene) og `../20261120_slaa_sammen_varer.check.sql`.

Delene lages med `node scripts/splitPendingSql.mjs <fil>`; `src/test/splitPendingSql.test.ts` kontrollerer
at delene på disk er like verktøyets utdata, at de satt sammen er originalen, og at kjøring gir samme funksjoner.

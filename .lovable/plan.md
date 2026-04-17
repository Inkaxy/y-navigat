
Plan stays as previously outlined. Single update: "Venter på tilgang"-skjermen får eksakt teksten brukeren ba om, med kun en "Logg ut"-knapp.

## Endringer fra forrige plan

**`PendingAccessScreen` (blokkerende skjerm når innlogget bruker mangler `users`-rad):**
- Fullskjerm-card, sentrert, lyst tema
- Tittel: "Venter på tilgang"
- Brødtekst (eksakt): _"Kontoen din er ikke ferdig satt opp. Dette er normalt for nye ansatte. Ta kontakt med plattform-ansvarlig for å fullføre registreringen."_
- Én knapp: "Logg ut" (kaller `supabase.auth.signOut()` og redirecter til `/login`)
- Ingen signup-lenke, ingen "prøv igjen", ingen kontakt-skjema, ingen selvhjelp

**Build-error fix (tsconfig.json):**
- Fjern `baseUrl` og bruk kun `paths: { "@/*": ["./src/*"] }` i compilerOptions for å fikse TS5102

Resten av planen (auth, layout, sider, app-switcher, bug-rapport, data-laget, UX) er uendret.

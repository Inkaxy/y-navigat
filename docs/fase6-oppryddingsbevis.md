# Fase 6 — opprydding av navngitte gamle kandidater (fra bc231c9b)

Metode: repo-lokal importgraf over alle `.ts/.tsx/.mjs/.js/.html` i `src/`, rotens HTML-innganger (17 stk), `scripts/` og `public/`.
Kanter: statisk `import … from`, `export … from` (re-eksport), sideeffekt-`import "…"`, dynamisk `import("…")`, `<script src>`, `require`, `@/`-alias og relative stier.
`import.meta.glob`: bare `src/assets/weather/index.ts` (`./*.svg`), treffer ingen kandidat. Innganger for nåbarhet: `src/main.tsx`, alle HTML-filer,
vite/vitest-konfig, alle `*.test.ts(x)` og `scripts/`. I tillegg tekstsøk på filnavnet i hele treet (fanger strengbaserte referanser).

## Slettet (ingen importør, ikke nåbar fra noen inngang, inkludert tester og dev-HTML)

| Fil | Linjer | git blob (før sletting) | Importører | Navneomtaler |
|---|---|---|---|---|
| `src/fakturaer/pages/Vareminne.tsx` | 236 | 4330bfd0ab93c264f14e8029ba4dc3a772ae033f | ingen | bare kommentar i `ChangeLinkDialog.tsx` («erstatter Vareminne») |
| `src/fakturaer/pages/RavarerQueue.tsx` | 94 | 7336b80169f2be61cb0ab5a58226858ed38c5f48 | ingen | ingen |
| `src/fakturaer/pages/IDag.tsx` | 144 | 3d2e924afaa5fe615376cef7f2dc58164ea6c789 | ingen | ingen |
| `src/fakturaer/pages/DecisionDetail.tsx` | 273 | 9856d9542022ce7bf733b669d5aced58c2a3fe85 | ingen | ingen |
| `src/fakturaer/pages/ReviewQueue.tsx` | 874 | ce65a8432661e8f748c395e50a23d8f5d4ddee54 | ingen | bare kommentarer i `BulkCreateRawMaterialsDialog.tsx` |

Ingen test ble fjernet eller endret for å få slettingen igjennom. Filene kan gjenopprettes fra git-historikken.

## Beholdt (nåbar)

- `src/fakturaer/components/inbox/QueueTable.tsx` — importeres av `src/dev/InvoicePreview.tsx`, som er inngang for `invoice-preview.html` (dev-forhåndsvisning).
- `src/fakturaer/components/decisions/DecisionNav.tsx` — importeres fortsatt av `InvoiceOverview.tsx`, `SupplierCases.tsx` og `Varekoblinger.tsx`.
- `src/ravarer/components/RavarerHeaderBanner.tsx` — levende (bl.a. Varetelling, MatchToleranser, ForhandlingerList); eksporterer også `NewRawMaterialButton`.
- `src/fakturaer/components/FakturaerHeaderBanner.tsx` — levende (ImportPdf via ImportSheet m.fl.).
- `src/fakturaer/pages/SupplierCase.tsx` — lazy-importert av `src/ravarer/routes.tsx` (`/ravarer/priskontroll/saker/:id`).

Filer som bare de slettede sidene brukte ble ikke ryddet videre (utenfor oppdraget).
`docs/ravarer-funksjonsmapping.json` refererer ingen slettet fil.

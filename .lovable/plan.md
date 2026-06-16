# Per-linje serveringsmodus + korrekt MVA

I dag har kurven én felles "Sitt her / Ta med"-bryter, og MVA tas rett fra produktets `mva_rate` (uten å reagere på serveringsmodus). Det matcher ikke virkeligheten der en kunde kan kjøpe kaffe (sitt her) og brød (ta med) i samme handel, og hvor norsk MVA-regel er:

- **Sitt her / servering på stedet → 25 % MVA**
- **Ta med / matvare → 15 % MVA**
- Ikke-mat (f.eks. servise, gavekort, klær) skal beholde sin egen sats uansett.

## Hva som endres

### 1. Datamodell (`products`)
Legg til `eatin_mva_rate numeric(5,2)` (nullable):
- `NULL` ⇒ produktet er ikke matvare → samme MVA i begge moduser (`products.mva_rate`).
- `25` ⇒ produktet er matvare → `15` ved takeaway (fra `mva_rate`), `25` ved eatin (fra `eatin_mva_rate`).

Backfill: alle produkter som i dag har `mva_rate = 15` settes til `eatin_mva_rate = 25` (typisk mat/drikke). De andre lar vi være `NULL`. Brukeren kan justere enkeltprodukter i Produkter-skjermen.

I `pos_record_sale` RPC utvides validering: tillatte satser pr linje er fortsatt `(0, 12, 15, 25)`; ingen endring i signatur. Klienten sender allerede `mva_rate` pr linje, så serveren stoler på den.

### 2. Klient — produkt-oppslag (`useProductLookup`)
Henter også `eatin_mva_rate`. Returnerer både `mva_rate` (base/takeaway) og `eatin_mva_rate` (kan være `null`).

### 3. Klient — kurv-logikk (`CartContext` + `cart.ts`)
`CartItem` utvides:
- `base_mva_rate` (takeaway-sats, fra produkt)
- `eatin_mva_rate: number | null`
- `mva_rate` blir **derivert** fra `dining_mode_override` (eller cart-default) + de to over.

Helper `effectiveMva(item, cartDefault)`:
```
mode = item.dining_mode_override ?? cartDefault
if mode === 'eatin' && eatin_mva_rate != null → eatin_mva_rate
else → base_mva_rate
```

`calcLine` / `calcTotals` tar `cartDefault` som ekstra arg slik at MVA-bøttene blir riktige. `serializeForCustomer` likeså. Alle eksisterende callere oppdateres.

Sammenslåing av like produkt-linjer i `addItem` slutter å slå sammen når `dining_mode_override` er satt eksplisitt (allerede halvveis sånn i dag), og linjer med ulik effektiv MVA holdes adskilt.

### 4. Klient — UI på kurv-linje (`CartLine.tsx`)
Hver linje får en liten pille-knapp («Sitt her» / «Ta med») som overstyrer cart-default. Tre tilstander: arve fra kurv, eksplisitt eatin, eksplisitt takeaway. Vises kun for matvare-produkter (de med `eatin_mva_rate != null`) — for ikke-mat har det ingen effekt og vi skjuler knappen for å unngå støy.

Linje-undertekst viser også effektiv MVA, f.eks. `15 % · Ta med` eller `25 % · Sitt her`.

### 5. Klient — øverste «kurv-default»-chip
Beholdes som i dag (`DiningChip`), men virker nå bare som standard for nye linjer (eksisterende linjer endres ikke automatisk når brukeren bytter cart-default — det matcher kassø-flow bedre). Vi kan vise en liten knapp «Bruk på alle» dersom ønsket — droppes i første runde.

### 6. Kasse → RPC payload
`toLinePayload` setter `mva_rate` = effektiv MVA (etter mode), og fortsetter å sende `dining_mode_override` for sporbarhet. Server lagrer som før.

### 7. Produkt-admin
I `Produkter.tsx` legges et lite felt for `eatin_mva_rate` (vises som «Sitt her-MVA»; tomt = ikke matvare). Detaljvisning, ikke obligatorisk i listen.

## Tekniske detaljer

- Migrasjon: `ALTER TABLE public.products ADD COLUMN eatin_mva_rate numeric(5,2) NULL`, pluss `UPDATE products SET eatin_mva_rate = 25 WHERE mva_rate = 15`. Ingen policy-endringer (eksisterende RLS dekker kolonnen).
- `pos_record_sale` trenger ikke endres (godtar 15 og 25 allerede).
- Realtime customer-display: `serializeForCustomer` får mode pr linje, så kunde-skjermen kan vise «Sitt her»-merke pr linje senere. Første runde sender vi kun `line_total` (uendret), men vi inkluderer `dining_mode` pr linje for fremtidig bruk.
- Selvbetjent kasse (`SelfServiceKasse`): samme UI på kurv-linjer; sender effektiv MVA på samme måte. Cart-default i selvbetjent forblir takeaway.

## Akseptansekriterier

1. Kaffe (matvare, takeaway 15) + sjokoladekake (matvare, takeaway 15) lagt i kurv med cart-default «Sitt her» beregner 25 % på begge.
2. Bytte enkelt-linje (kaffen) til «Sitt her» mens kurv-default er «Ta med»: bare kaffen får 25 %, brødet beholder 15 %.
3. Ikke-mat-produkt (mva 25, `eatin_mva_rate=NULL`): MVA er alltid 25 %, og dining-pille vises ikke.
4. MVA-breakdown i totals og kvittering reflekterer per-linje-satsene; `pos_record_sale` lagrer korrekt sats pr linje.
5. Eksisterende kvitteringer/rapporter er bakoverkompatible.

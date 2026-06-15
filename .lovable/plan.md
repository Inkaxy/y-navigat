## Hvorfor hentestedene ikke vises

Kakebyggeren henter hentesteder via vanlig `supabase`-klient (auth-session for innlogget bruker). RLS på `pickup_locations` krever `has_position_in_entity(legal_entity_id)`:

```
pickup_locations_select_in_entity:
  has_position_in_entity(legal_entity_id) OR is_platform_admin()
```

I kiosk-skallet er operatøren logget inn via PIN mot `pos_operators` — det er **ikke** en Supabase-auth-bruker med en `user_position`-rad. Resultatet er at SELECT returnerer 0 rader, dropdownen er tom, og `defaultPickupLocationId` matcher heller ingenting (så ingen forhåndsvalg).

Kasse sender også `terminal.outlet_id` som `defaultPickupLocationId`. Det er riktig FK til `pickup_locations.id`, men siden listen er tom kan den ikke velges.

Data i basen er OK: 11 aktive hentesteder (Teie, Borgheim, Sem, Skallestad, …) ligger på legal entity `751709bc-…`.

## Hvor du registrerer hentesteder

`Kunder` → `Hentesteder` (siden `src/kunder/pages/PickupLocations.tsx`). Der opprettes Teie, Borgheim, Skallestad osv. Et hentested knyttes til en kunde via:
- `customer_profiles.pickup_location_id` (profil-default), eller
- `customers.profile_overrides.pickup_location_id` (override per kunde).

POS-terminalens eget hentested settes på `pos_terminals.outlet_id` i `POS-styring` → `Terminaler`.

## Fix

1. **`CustomerStartStep.tsx`** — bytt fra `supabase` til en injisert klient. Legg til prop `client?: SupabaseClient` (default `supabase`). Bruk den i `useEffect`-fetchen.
2. **`KakebyggerModal.tsx`** — send `client={kioskSupabase}` til `CustomerStartStep` slik at kiosk-konteksten bruker anon-klienten som omgår auth-sessionen.
3. **RLS på `pickup_locations`** — utvid SELECT-policyen til å tillate anon/POS-lesing av aktive hentesteder, slik at kiosk-skallet (uten auth-bruker) kan vise dem:

   ```sql
   CREATE POLICY pickup_locations_select_pos_active
   ON public.pickup_locations FOR SELECT
   TO anon, authenticated
   USING (status = 'active');
   GRANT SELECT ON public.pickup_locations TO anon;
   ```

   Hentesteder er ikke sensitiv data (navn + nummer + adresse på utsalg), og er allerede synlige for kunder via henteflyten — trygt å eksponere aktive rader.
4. **Default-valg** — `defaultPickupLocationId` (= `terminal.outlet_id`) vil nå matche en rad og bli forhåndsvalgt automatisk via eksisterende `useEffect` i `CustomerStartStep`.

## Filer som endres

- `src/varer/features/cakeBuilder/components/CustomerStartStep.tsx`
- `src/kiosk/components/KakebyggerModal.tsx`
- Ny migrasjon for RLS-policy på `pickup_locations`

## Ikke i scope

- Endre hvordan kiosk-operatører autentiseres
- Endre `customers`/`customer_profiles`-kobling til hentesteder

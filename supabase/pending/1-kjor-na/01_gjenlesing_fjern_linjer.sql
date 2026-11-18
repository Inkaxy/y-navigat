-- 20261123_gjenlesing_fjern_linjer.PENDING.sql — IKKE KJØRT. Kjøres av root etter Henriks ja. Én fil (< 15 kB).
--
-- PROBLEM: samlet gjenlesing 17.11 la til 11 pantlinjer for mye på seks Coca-Cola-fakturaer. rm_apply_invoice_reread kunne
-- bare rette (update) og legge til (add); en gammel linje uten motstykke i ny lesing ble stående ved siden av den nye.
--
-- HVA SOM ENDRES:
--  1. Ny hjelpefunksjon public._rm_reread_line_protection(uuid) → tekst eller null. Ikke kallbar fra klient.
--     Beskyttet (kan aldri fjernes): manuell kobling, godtatt pris, holdt utenfor, «ikke vare», rettet linje, ført kost,
--     varemottak, lagerparti, lagerbevegelse, avvikssak, startpris for leverandørvare.
--  2. rm_apply_invoice_reread (live md5 c9c68ddd556312ec0b03d5d3365d4e6a), bare eksakte tekstbytter:
--     a) Nye operasjoner «remove» (line_id + confirmed_removal) og «keep» (candidate_id + line_id + confirmed_keep).
--        remove: bare ubeskyttede linjer; hele raden lagres i audit_log ('invoice_line.reread_removed', changes.before)
--        før sletting. keep: kandidatens linjesum må være lik linjens.
--     b) ERSTATNING: finnes remove/keep i forespørselen, må den dekke ALT: hver kandidat brukt (update/add/keep) og hver
--        gammel linje valgt (update/keep/remove). Etterpå må linjesummen være nøyaktig lik summen av ny lesing (±0,005),
--        ellers rulles alt tilbake ('erstatning_ufullstendig' / 'erstatning_sum_avviker'). En beskyttet linje uten
--        motstykke stopper dermed erstatningen – den må pares (update/keep), aldri fjernes.
--     c) VANLIG BRUK (bare update/add, som i dag): legges det til linjer og summen ender med avvik som er STØRRE enn før,
--        rulles alt tilbake ('sumavvik_ville_oke'). Rester kan dermed ikke lenger øke linjesummen.
--     d) Resultat og revisjonslogg får 'replace' (true/false). Alt annet i funksjonen er uendret.
--  3. Ny markør public.rm_cap_gjenlesing_fjern_v1(). Appen sender remove/keep FØRST når den finnes.
--
-- HVA SOM IKKE ENDRES: ingen tabeller/kolonner/RLS/tilganger; filen skriver ingen rader. Eksisterende sperrer (avstemt,
-- flagget, godkjent, ført kost, øyeblikksbilde, eier, utløp, begrunnelse, replay) er uendret.
-- Ved fjerning gjør eksisterende triggere det de gjør ved all sletting: prisobservasjonen markeres som slettet,
-- kostprisen regnes ut på nytt, innkjøpsspeil og lagerbevegelse for linjen fjernes (lagerbevegelse er beskyttet, se 1).
--
-- Kontroll: 20261123_gjenlesing_fjern_linjer.check.sql (før/etter + md5). Lokal test: node scripts/test-gjenlesing-fjern-sql.mjs
-- Innliming: tåler Windows-linjeskift (18.11) – ankrene renses for CR/hardt mellomrom/tabulator før de sammenlignes med
-- uendret live-tekst, og sluttsteget nederst skriver funksjonene på nytt uten CR. Test: node scripts/test-innliming-crlf.mjs
begin;

create or replace function public._rm_reread_line_protection(p_line_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when l.id is null then 'finnes_ikke'
    when l.match_confidence::text = 'manual' and l.raw_material_id is not null then 'manuell_kobling'
    when l.price_acceptance is not null then 'godtatt_pris'
    when l.excluded_at is not null then 'holdt_utenfor'
    when l.match_confidence::text = 'not_applicable' or l.excluded_raw_material_id is not null then 'ikke_vare'
    when exists (select 1 from invoice_line_corrections c where c.invoice_line_id = l.id) then 'rettet'
    when exists (select 1 from invoice_line_cost_postings c where c.invoice_line_id = l.id) then 'kost_fort'
    when exists (select 1 from rm_goods_receipts g where g.invoice_line_id = l.id) then 'varemottak'
    when exists (select 1 from rm_stock_lots s where s.invoice_line_id = l.id) then 'lagerparti'
    when exists (select 1 from stock_movements m where m.source_table = 'invoice_lines' and m.source_id = l.id) then 'lagerbevegelse'
    when exists (select 1 from supplier_deviation_case_lines d where d.invoice_line_id = l.id) then 'avvikssak'
    when exists (select 1 from raw_material_suppliers r where r.start_price_invoice_line_id = l.id) then 'startpris'
    else null end
  from (select p_line_id as x) s left join invoice_lines l on l.id = s.x
$$;
revoke all on function public._rm_reread_line_protection(uuid) from public, anon, authenticated;
grant execute on function public._rm_reread_line_protection(uuid) to service_role;

do $$
declare d text; s_old text; s_new text;
  procedure_sig constant text := 'public.rm_apply_invoice_reread(uuid,jsonb,text)';
begin
  if to_regprocedure('public.rm_cap_gjenlesing_fjern_v1()') is not null then raise exception 'Filen er allerede kjørt (rm_cap_gjenlesing_fjern_v1 finnes).'; end if;
  d := replace(pg_get_functiondef(procedure_sig::regprocedure), chr(13), '');
  if md5(d) <> 'c9c68ddd556312ec0b03d5d3365d4e6a' then raise exception 'rm_apply_invoice_reread er endret siden 18.11 (md5 %)', md5(d); end if;

  -- a) variabler
  s_old := $x$ k text; new_id uuid; sumcheck jsonb; rematch jsonb; learn boolean; overridden boolean; was_manual boolean; identity_changed boolean;
$x$;
  s_new := s_old || $x$ old_ids uuid[]:='{}'; replace_mode boolean:=false; prot text; before_check jsonb; cand_sum numeric; final_sum numeric;
$x$;
  s_old := replace(replace(replace(s_old, chr(13), ''), chr(160), ' '), chr(9), ' '); s_new := replace(replace(replace(s_new, chr(13), ''), chr(160), ' '), chr(9), ' ');
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'anker a finnes ikke nøyaktig én gang'; end if;
  d := replace(d, s_old, s_new);

  -- b) sluttkontroll før sumkontrollen (gjøres før anker c, som inneholder samme tekst med «before_check»)
  s_old := $x$ SELECT rm_lines_sum_check(sum(total_amount),count(*)::int,v.total_amount,v.total_vat,coalesce(v.is_credit_note,false)) INTO sumcheck FROM invoice_lines WHERE invoice_id=v.id;
$x$;
  s_new := $x$ IF replace_mode THEN
  -- Erstatning: alle kandidater brukt, alle gamle linjer valgt, og linjesum = ny lesing. Ingen rester.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(rr.proposal->'candidates') c WHERE NOT (c->>'candidate_id')=ANY(candidate_ids)) THEN RAISE EXCEPTION 'erstatning_ufullstendig'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(old_ids) x WHERE NOT x=ANY(target_ids)) THEN RAISE EXCEPTION 'erstatning_ufullstendig'; END IF;
  SELECT sum((c->'values'->>'total_amount')::numeric) INTO cand_sum FROM jsonb_array_elements(rr.proposal->'candidates') c;
  SELECT sum(total_amount) INTO final_sum FROM invoice_lines WHERE invoice_id=v.id;
  IF cand_sum IS NULL OR final_sum IS NULL OR abs(final_sum-cand_sum)>0.005 THEN RAISE EXCEPTION 'erstatning_sum_avviker'; END IF;
 END IF;
$x$ || s_old || $x$ IF NOT replace_mode AND EXISTS(SELECT 1 FROM jsonb_array_elements(results) r WHERE r->>'kind'='add')
   AND sumcheck->>'lines_sum_status'='mismatch' AND before_check->>'lines_sum_variance_pct' IS NOT NULL AND sumcheck->>'lines_sum_variance_pct' IS NOT NULL
   AND abs((sumcheck->>'lines_sum_variance_pct')::numeric) > abs((before_check->>'lines_sum_variance_pct')::numeric)+0.01 THEN
  RAISE EXCEPTION 'sumavvik_ville_oke';
 END IF;
$x$;
  s_old := replace(replace(replace(s_old, chr(13), ''), chr(160), ' '), chr(9), ' '); s_new := replace(replace(replace(s_new, chr(13), ''), chr(160), ' '), chr(9), ' ');
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'anker b finnes ikke nøyaktig én gang'; end if;
  d := replace(d, s_old, s_new);

  -- c) utgangspunkt: gamle linjer, sum før, modus
  s_old := $x$ SELECT coalesce(max(line_number),0) INTO nextline FROM invoice_lines WHERE invoice_id=v.id;
$x$;
  s_new := s_old || $x$ SELECT coalesce(array_agg(id),'{}') INTO old_ids FROM invoice_lines WHERE invoice_id=v.id;
 SELECT rm_lines_sum_check(sum(total_amount),count(*)::int,v.total_amount,v.total_vat,coalesce(v.is_credit_note,false)) INTO before_check FROM invoice_lines WHERE invoice_id=v.id;
 replace_mode:=EXISTS(SELECT 1 FROM jsonb_array_elements(p_operations) o WHERE jsonb_typeof(o)='object' AND o->>'kind' IN ('remove','keep'));
$x$;
  s_old := replace(replace(replace(s_old, chr(13), ''), chr(160), ' '), chr(9), ' '); s_new := replace(replace(replace(s_new, chr(13), ''), chr(160), ' '), chr(9), ' ');
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'anker c finnes ikke nøyaktig én gang'; end if;
  d := replace(d, s_old, s_new);

  -- d) nye bekreftelsesfelt
  s_old := $x$'confirm_identity_change','confirmed_addition'] LOOP$x$;
  s_new := $x$'confirm_identity_change','confirmed_addition','confirmed_removal','confirmed_keep'] LOOP$x$;
  s_old := replace(replace(replace(s_old, chr(13), ''), chr(160), ' '), chr(9), ' '); s_new := replace(replace(replace(s_new, chr(13), ''), chr(160), ' '), chr(9), ' ');
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'anker d finnes ikke nøyaktig én gang'; end if;
  d := replace(d, s_old, s_new);

  -- e) remove / keep
  s_old := $x$  IF kind IS NULL OR kind NOT IN ('update','add') THEN RAISE EXCEPTION 'operasjon_ikke_stottet'; END IF;
$x$;
  s_new := $x$  IF kind IS NULL OR kind NOT IN ('update','add','remove','keep') THEN RAISE EXCEPTION 'operasjon_ikke_stottet'; END IF;
  IF kind IN ('remove','keep') THEN
   lid:=(op->>'line_id')::uuid;
   IF lid IS NULL OR lid=ANY(target_ids) THEN RAISE EXCEPTION 'linje_valgt_flere_ganger'; END IF;
   SELECT * INTO l FROM invoice_lines WHERE id=lid AND invoice_id=v.id;
   IF NOT FOUND THEN RAISE EXCEPTION 'linje_tilhorer_annen_faktura'; END IF;
   target_ids:=array_append(target_ids,lid);
   IF kind='remove' THEN
    IF coalesce((op->>'confirmed_removal')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'fjerning_ma_bekreftes'; END IF;
    IF cid IS NOT NULL THEN RAISE EXCEPTION 'ugyldige_valg'; END IF;
    prot:=_rm_reread_line_protection(lid);
    IF prot IS NOT NULL THEN RAISE EXCEPTION 'beskyttet_linje_kan_ikke_fjernes: %',prot; END IF;
    INSERT INTO audit_log(user_id,action,entity_type,entity_id,entity_display_reference,legal_entity_id,changes,reason,source_app)
    VALUES(uid,'invoice_line.reread_removed','invoice_line',lid,v.invoice_number,v.legal_entity_id,jsonb_build_object('run_id',rr.id,'before',to_jsonb(l)),btrim(p_reason),'ravarer');
    DELETE FROM invoice_lines WHERE id=lid;
    results:=results||jsonb_build_array(jsonb_build_object('kind','remove','candidate_id',NULL,'line_id',lid));
   ELSE
    IF coalesce((op->>'confirmed_keep')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'beholdt_linje_ma_bekreftes'; END IF;
    IF cid IS NULL OR cid=ANY(candidate_ids) THEN RAISE EXCEPTION 'kandidat_brukt_flere_ganger'; END IF;
    SELECT c INTO cand FROM jsonb_array_elements(rr.proposal->'candidates') c WHERE c->>'candidate_id'=cid;
    IF NOT FOUND THEN RAISE EXCEPTION 'kandidat_finnes_ikke'; END IF;
    candidate_ids:=array_append(candidate_ids,cid);
    IF jsonb_typeof(cand->'values'->'total_amount') IS DISTINCT FROM 'number' OR (cand->'values'->>'total_amount')::numeric IS DISTINCT FROM l.total_amount THEN RAISE EXCEPTION 'beholdt_linje_har_annen_sum'; END IF;
    results:=results||jsonb_build_array(jsonb_build_object('kind','keep','candidate_id',cid,'line_id',lid));
   END IF;
   n:=n+1;
   CONTINUE;
  END IF;
$x$;
  s_old := replace(replace(replace(s_old, chr(13), ''), chr(160), ' '), chr(9), ' '); s_new := replace(replace(replace(s_new, chr(13), ''), chr(160), ' '), chr(9), ' ');
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'anker e finnes ikke nøyaktig én gang'; end if;
  d := replace(d, s_old, s_new);

  -- f) modus i svar og revisjonslogg
  s_old := $x$'lines_sum_status',sumcheck->>'lines_sum_status','replayed',false);$x$;
  s_new := $x$'lines_sum_status',sumcheck->>'lines_sum_status','replayed',false,'replace',replace_mode);$x$;
  s_old := replace(replace(replace(s_old, chr(13), ''), chr(160), ' '), chr(9), ' '); s_new := replace(replace(replace(s_new, chr(13), ''), chr(160), ' '), chr(9), ' ');
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'anker f finnes ikke nøyaktig én gang'; end if;
  d := replace(d, s_old, s_new);
  s_old := $x$jsonb_build_object('run_id',rr.id,'operations',results,'document_sha256',rr.document_sha256)$x$;
  s_new := $x$jsonb_build_object('run_id',rr.id,'operations',results,'document_sha256',rr.document_sha256,'replace',replace_mode)$x$;
  s_old := replace(replace(replace(s_old, chr(13), ''), chr(160), ' '), chr(9), ' '); s_new := replace(replace(replace(s_new, chr(13), ''), chr(160), ' '), chr(9), ' ');
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'anker g finnes ikke nøyaktig én gang'; end if;
  d := replace(d, s_old, s_new);

  execute d;
end $$;

create or replace function public.rm_cap_gjenlesing_fjern_v1()
returns boolean language sql stable security invoker set search_path = public as $$ select true $$;
revoke all on function public.rm_cap_gjenlesing_fjern_v1() from public, anon;
grant execute on function public.rm_cap_gjenlesing_fjern_v1() to authenticated, service_role;

-- Linjeskift: limes filen inn med Windows-linjeskift (CR+LF), får funksjonene over et usynlig CR-tegn i kroppen.
-- Denne blokken skriver dem på nytt med bare LF, slik at kontrollsummene blir de samme uansett innliming.
-- Gjør ingenting når alt allerede er LF. Rører bare funksjonene denne filen oppretter.
do $lf$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = any (array['_rm_reread_line_protection', 'rm_apply_invoice_reread', 'rm_cap_gjenlesing_fjern_v1'])
              and p.prokind = 'f' and strpos(p.prosrc, chr(13)) > 0 loop
    execute replace(pg_get_functiondef(r.oid), chr(13), '');
  end loop;
end $lf$;

commit;

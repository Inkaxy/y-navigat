-- 20261121_kobling_godkjent_faktura.PENDING.sql — VEDTATT AV HENRIK 17.11.2026 14:21 UTC. IKKE KJØRT. Kjøres av root.
--
-- Beslutning: en fakturalinje kan kobles til en vare (koble, opprett som ny, «Ikke vare», hold utenfor, pakningsbekreftelse,
-- angre) selv om fakturaen er godkjent internt. Fortsatt låst: fakturaer som er avstemt (status reconciled/reconciled_at),
-- flagget, utelatt (excluded) eller kansellert, og linjer med aktiv ført kostpris (invoice_line_cost_postings, revoked_at null).
--
-- HVA SOM ENDRES (bare eksakte tekstbytter i eksisterende funksjoner; hver tekst må finnes nøyaktig én gang):
--  1. rm_confirm_line_match            (live md5 e2958f267da2cb5fc70f1af49c97d60a)
--     «faktura_godkjent»-sperren gjelder fortsatt for alle DIREKTE kall (fakturaflatens linjekobling, acceptMatch), men hoppes
--     over når funksjonen kalles fra rm_link_supplier_item i samme transaksjon (transaksjonslokal innstilling rm.link_approved='on';
--     kan ikke settes av klienten via PostgREST, og nullstilles rett etter koblingssløyfen).
--  2. rm_link_supplier_item            (live md5 acc4fdb14510e96d4b21cb5b7e74d28a)
--     Linjeutvalget forkaster ikke lenger linjer bare fordi fakturaen er godkjent internt. Setter rm.link_approved rundt kallene
--     til rm_confirm_line_match og nullstiller den etterpå. Status-, flagg-, not_applicable- og kostføringsfiltrene står uendret.
--     Gjelder koble, opprett som ny, pakningsbekreftelse (p_package) og «Ikke vare» (p_not_raw_material).
--  3. rm_undo_not_item                 (live md5 7855ce549d7802eea49daef4d7179057)
--     «Angre Ikke vare» hopper ikke lenger over linjer på internt godkjente fakturaer. Avstemt/flagget/lukket og ført kost
--     hoppes fortsatt over (faktura_last / kostpris_fort).
--  4. rm_set_invoice_exclusion         (live md5 67856afa654835ae12a3903f2984d92e)
--     «Hold utenfor» for ÉN LINJE er lov på internt godkjent faktura. Å holde HELE fakturaen utenfor er fortsatt sperret
--     (det ville endret fakturastatus og dermed godkjenningsgrunnlaget). Avstemt og linjer med kost/lager/varemottak/
--     prisobservasjon (_rm_line_exclusion_blocker) er fortsatt sperret. Angre (rm_reopen_invoice_exclusion) har ingen
--     godkjenningssperre og er uendret.
--  5. rm_work_items                    (live md5 efe0f95ef98471bbfca5713d05960e27)
--     a) En linje med aktiv ført kostpris telles ikke som åpen (samme regel som koblingen).
--     b) «Ukoblet» (Nye varer) krever minst én åpen linje. En vare uten linjer koblingen godtar vises ikke lenger.
--  6. rm_new_items_queue (finnes bare hvis 20261119_nye_varer_les er kjørt): samme regel 5b. Filen 20261119_nye_varer_les
--     er rettet tilsvarende, så rekkefølgen mellom de to filene spiller ingen rolle.
--  7. rm_undo_supplier_item_link (finnes bare hvis 20261119_fra_faktura er kjørt): «Angre kobling» hopper ikke lenger over
--     linjer på internt godkjente fakturaer. Filen 20261119_fra_faktura er rettet tilsvarende.
--  8. Ny markør public.rm_cap_kobling_godkjent_v1(). Appen og match-invoice-lines endrer oppførsel FØRST når den finnes.
-- Kø og kobling bruker dermed samme regel for hva som kan løses: krever gjennomgang, faktura imported/needs_review/ready,
-- ikke flagget, ikke utelatt, ikke not_applicable, ingen aktiv ført kostpris. Intern godkjenning er ikke en del av regelen.
--
-- HVA SOM IKKE ENDRES:
--  - Ingen tabeller, kolonner, data, triggere, RLS eller tilganger endres. Filen skriver ingen rader.
--  - Intern godkjenning (invoice_internal_approvals) oppheves eller endres ikke. Lagret grunnlag (basis) = totalbeløp, mva,
--    valuta, linjesumstatus, linjesum og fakturastatus. Ingen av endringene skriver til invoices; koblingen endrer bare
--    invoice_lines-feltene for vare/kobling/gjennomgang (raw_material_id, match_confidence, requires_review, review_reason,
--    base_quantity, price_per_base_unit, resolved_*). Beløp, mva, antall, enhet og linjetekst røres ikke.
--  - «Prisen stemmer» (accept_invoice_line_price_variance) og angre av den (rm_undo_price_acceptance) er fortsatt sperret på
--    internt godkjente fakturaer. Linjeretting (rm_correct_invoice_line) og gjenlesing er fortsatt sperret.
--
-- PRIS OG KOST ETTER KOBLING PÅ GODKJENT FAKTURA:
--  - Koblingen setter linjen til «må beregnes på nytt» (recalculation_pending), som i dag. link-supplier-item kaller så
--    match-invoice-lines med de endrede linjene. Når markøren finnes, beregner match-invoice-lines disse manuelt koblede
--    linjene på en internt godkjent faktura på vanlig måte (pakning, pris per grunnenhet, avvik), men endrer IKKE
--    fakturastatus, avstemmer ikke og normaliserer ikke enheten. Uten markøren er fakturaen låst som før.
--  - Prisobservasjon: når linjen er ferdig beregnet uten åpne årsaker, lager triggeren fn_invoice_line_match_price_history
--    en prisobservasjon på vanlig måte (samme kontroller: faktura klar/avstemt eller linjene stoler på, NOK, ikke flagget,
--    gyldig pris og mengde). Linjer med åpne årsaker (prisavvik, pakning, lesevarsel) gir ikke observasjon før de er løst.
--  - JA, GJELDENDE KOSTPRIS KAN ENDRES: triggeren kaller rm_apply_derived_cost_price, som velger nyeste gyldige observasjon
--    etter dato (_rm_cost_candidates). Er den nye observasjonen den nyeste gyldige, flyttes varens kostpris. Lagerførte
--    varer kan også få en innkjøpsbevegelse (stock_from_invoice_line), som ved all annen kobling. Angre kobling erstatter
--    observasjonen (superseded) og regner kostprisen ut på nytt.
--  - «FERDIG»-REGELEN ER UENDRET: Ferdig krever avstemt + aktiv godkjenning + sum ok + ingen åpne linjer + all kost ført.
--    Koblingen avstemmer ikke og fører ikke kost, så fakturaen blir aldri Ferdig av koblingen alene. Den kan få færre
--    åpne linjer, slik at den senere oppfyller kravet «ingen åpne linjer».
--
-- Stopper hvis noen funksjon er endret siden 17.11 (md5), eller hvis det forkastede alternativet B
-- (rm_cap_ko_uten_godkjent_v1) mot formodning er kjørt. Kontroll før/etter: 20261121_kobling_godkjent_faktura.check.sql.
-- Lokal test: node scripts/test-kobling-godkjent-sql.mjs (kjører filen mot dagens funksjonskopier i PGlite).
begin;

do $$
declare d text; n text; s_old text; s_new text;
  appr_skip constant text := $x$    if exists (select 1 from public.invoice_internal_approvals a where a.invoice_id = r.invoice_id and a.status = 'approved' and a.revoked_at is null) then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'faktura_godkjent'); continue;
    end if;
$x$;
begin
  if to_regprocedure('public.rm_cap_ko_uten_godkjent_v1()') is not null then
    raise exception 'Alternativ B (20261121_ko_uten_godkjent, forkastet) er kjørt – stopp og kontroller før denne filen kjøres.';
  end if;
  if to_regprocedure('public.rm_cap_kobling_godkjent_v1()') is not null then
    raise exception 'Filen er allerede kjørt (rm_cap_kobling_godkjent_v1 finnes).';
  end if;

  -- 1. rm_confirm_line_match
  d := pg_get_functiondef('public.rm_confirm_line_match(uuid,uuid,numeric,text,numeric,boolean,numeric,boolean,uuid[],boolean)'::regprocedure);
  if md5(d) <> 'e2958f267da2cb5fc70f1af49c97d60a' then raise exception 'rm_confirm_line_match er endret siden 17.11 (md5 %)', md5(d); end if;
  s_old := $x$  if exists(select 1 from public.invoice_internal_approvals a where a.invoice_id=i.id and a.status='approved') then
    return jsonb_build_object('ok',false,'reason','faktura_godkjent');
  end if;
$x$;
  s_new := $x$  -- Intern godkjenning sperrer direkte kall. rm_link_supplier_item (samme transaksjon) kan koble linjer på en
  -- godkjent, fortsatt åpen faktura; beløp, mva, fakturastatus og godkjenning endres ikke av koblingen.
  if exists(select 1 from public.invoice_internal_approvals a where a.invoice_id=i.id and a.status='approved')
     and coalesce(current_setting('rm.link_approved', true), '') <> 'on' then
    return jsonb_build_object('ok',false,'reason','faktura_godkjent');
  end if;
$x$;
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'rm_confirm_line_match: sperren finnes ikke nøyaktig én gang'; end if;
  execute replace(d, s_old, s_new);

  -- 2. rm_link_supplier_item
  d := pg_get_functiondef('public.rm_link_supplier_item(uuid,uuid,text,uuid,jsonb,jsonb,boolean,boolean,text,uuid[])'::regprocedure);
  if md5(d) <> 'acc4fdb14510e96d4b21cb5b7e74d28a' then raise exception 'rm_link_supplier_item er endret siden 17.11 (md5 %)', md5(d); end if;
  s_old := $x$      and not exists(select 1 from public.invoice_internal_approvals a where a.invoice_id=i.id and a.status='approved')
$x$;
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'rm_link_supplier_item: godkjenningsfilteret finnes ikke nøyaktig én gang'; end if;
  n := replace(d, s_old, '');
  s_old := $x$  -- D) Åpne linjer per faktura → rm_confirm_line_match
$x$;
  s_new := $x$  -- D) Åpne linjer per faktura → rm_confirm_line_match
  -- Linjer på internt godkjente (åpne) fakturaer kan kobles; rm_confirm_line_match godtar dem bare mens denne er på.
  perform set_config('rm.link_approved', 'on', true);
$x$;
  if (length(n) - length(replace(n, s_old, ''))) <> length(s_old) then raise exception 'rm_link_supplier_item: anker D finnes ikke nøyaktig én gang'; end if;
  n := replace(n, s_old, s_new);
  s_old := $x$  -- E) Leverandørkobling finnes alltid etterpå
$x$;
  s_new := $x$  perform set_config('rm.link_approved', '', true);
  -- E) Leverandørkobling finnes alltid etterpå
$x$;
  if (length(n) - length(replace(n, s_old, ''))) <> length(s_old) then raise exception 'rm_link_supplier_item: anker E finnes ikke nøyaktig én gang'; end if;
  execute replace(n, s_old, s_new);

  -- 3. rm_undo_not_item
  d := pg_get_functiondef('public.rm_undo_not_item(uuid,uuid,text,uuid[],boolean,text)'::regprocedure);
  if md5(d) <> '7855ce549d7802eea49daef4d7179057' then raise exception 'rm_undo_not_item er endret siden 17.11 (md5 %)', md5(d); end if;
  if (length(d) - length(replace(d, appr_skip, ''))) <> length(appr_skip) then raise exception 'rm_undo_not_item: sperren finnes ikke nøyaktig én gang'; end if;
  execute replace(d, appr_skip, '');

  -- 4. rm_set_invoice_exclusion (bare linjenivå; anker med linjeskift foran, så fakturanivåets innrykkede kopi ikke treffes)
  d := pg_get_functiondef('public.rm_set_invoice_exclusion(uuid,text,uuid,text,text,text,uuid)'::regprocedure);
  if md5(d) <> '67856afa654835ae12a3903f2984d92e' then raise exception 'rm_set_invoice_exclusion er endret siden 17.11 (md5 %)', md5(d); end if;
  s_old := $x$
  if v_inv.status = 'reconciled' or v_inv.reconciled_at is not null then return jsonb_build_object('ok', false, 'error', 'faktura_avstemt'); end if;
  if exists (select 1 from invoice_internal_approvals a where a.invoice_id = v_inv.id and a.status = 'approved' and a.revoked_at is null) then
    return jsonb_build_object('ok', false, 'error', 'faktura_godkjent');
  end if;
$x$;
  s_new := $x$
  if v_inv.status = 'reconciled' or v_inv.reconciled_at is not null then return jsonb_build_object('ok', false, 'error', 'faktura_avstemt'); end if;
  -- Én linje kan holdes utenfor også på internt godkjent faktura (fakturaen og godkjenningen endres ikke).
$x$;
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'rm_set_invoice_exclusion: linjesperren finnes ikke nøyaktig én gang'; end if;
  execute replace(d, s_old, s_new);

  -- 5. rm_work_items
  d := pg_get_functiondef('public.rm_work_items(uuid,text,text,uuid,text,integer,integer)'::regprocedure);
  if md5(d) <> 'efe0f95ef98471bbfca5713d05960e27' then raise exception 'rm_work_items er endret siden 17.11 (md5 %)', md5(d); end if;
  s_old := $x$(i.status in ('imported','needs_review','ready') and i.flagged_at is null) is_open$x$;
  s_new := $x$(i.status in ('imported','needs_review','ready') and i.flagged_at is null
             and not exists (select 1 from public.invoice_line_cost_postings cp where cp.invoice_line_id = il.id and cp.revoked_at is null)) is_open$x$;
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'rm_work_items: is_open finnes ikke nøyaktig én gang'; end if;
  n := replace(d, s_old, s_new);
  s_old := $x$             when a.linked_rm_id is null then 'ukoblet'
$x$;
  s_new := $x$             when a.linked_rm_id is null and a.open_lines > 0 then 'ukoblet'
$x$;
  if (length(n) - length(replace(n, s_old, ''))) <> length(s_old) then raise exception 'rm_work_items: ukoblet finnes ikke nøyaktig én gang'; end if;
  execute replace(n, s_old, s_new);

  -- 6. rm_new_items_queue (bare hvis 20261119_nye_varer_les er kjørt; den rettede utgaven har regelen allerede)
  if to_regprocedure('public.rm_new_items_queue(uuid,uuid,integer,integer)') is not null then
    d := pg_get_functiondef('public.rm_new_items_queue(uuid,uuid,integer,integer)'::regprocedure);
    s_old := $x$       and (a.linked_rm_id is null
            or (a.open_lines > 0
                and coalesce(a.reasons_raw,'') ~ '(unknown_package_size|package_conflict|missing_base_unit|uncertain_cost)'))
$x$;
    s_new := $x$       and a.open_lines > 0
       and (a.linked_rm_id is null
            or coalesce(a.reasons_raw,'') ~ '(unknown_package_size|package_conflict|missing_base_unit|uncertain_cost)')
$x$;
    if (length(d) - length(replace(d, s_old, ''))) = length(s_old) then
      execute replace(d, s_old, s_new);
    elsif (length(d) - length(replace(d, s_new, ''))) <> length(s_new) then
      raise exception 'rm_new_items_queue: kjent utvalg finnes ikke – kontroller funksjonen';
    end if;
  end if;

  -- 7. rm_undo_supplier_item_link (bare hvis 20261119_fra_faktura er kjørt; den rettede utgaven har ikke sperren)
  if to_regprocedure('public.rm_undo_supplier_item_link(uuid,uuid,text,uuid[],uuid,boolean,text)') is not null then
    d := pg_get_functiondef('public.rm_undo_supplier_item_link(uuid,uuid,text,uuid[],uuid,boolean,text)'::regprocedure);
    if (length(d) - length(replace(d, appr_skip, ''))) = length(appr_skip) then
      execute replace(d, appr_skip, '');
    elsif strpos(d, 'faktura_godkjent') > 0 then
      raise exception 'rm_undo_supplier_item_link: ukjent godkjenningssperre – kontroller funksjonen';
    end if;
  end if;
end $$;

create or replace function public.rm_cap_kobling_godkjent_v1()
returns boolean language sql stable security invoker set search_path = public as $$ select true $$;
revoke all on function public.rm_cap_kobling_godkjent_v1() from public, anon;
grant execute on function public.rm_cap_kobling_godkjent_v1() to authenticated, service_role;

commit;

-- Bare SELECT. Kjør før og etter 20261117_beslutninger_angre.PENDING.sql.
-- Før: md5 skal være 35d0e2bd23aff1c85459c4299db189d9 og de nye funksjonene skal mangle.
select md5(pg_get_functiondef('public._rm_retain_price_acceptance'::regproc)) as retain_md5,
       position('rm.undo_price_acceptance' in pg_get_functiondef('public._rm_retain_price_acceptance'::regproc)) > 0 as retain_har_angring;
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_kan,
       has_function_privilege('anon', p.oid, 'execute') as anon_kan
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('rm_undo_price_acceptance','rm_undo_not_item','rm_cap_beslutninger_v1');
-- Hvor mange åpne fakturaer har godtatte prisavvik som kunne angres (bare telling, ingen endring).
select count(*) as godtatte_linjer_pa_apne_fakturaer
  from invoice_lines il join invoices i on i.id = il.invoice_id
 where il.price_acceptance is not null and not il.requires_review
   and i.status in ('imported','needs_review','ready') and i.flagged_at is null and i.reconciled_at is null;

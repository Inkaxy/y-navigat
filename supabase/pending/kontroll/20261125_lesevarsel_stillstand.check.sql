-- Kontroll for 20261125_lesevarsel_stillstand (bare SELECT).
-- 1) Funksjonen finnes, er security definer og kan bare kjøres av service_role.
select p.proname, p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_kan_kjore,
       has_function_privilege('service_role', p.oid, 'execute') as service_kan_kjore,
       md5(p.prosrc) as md5_kropp
from pg_proc p where p.oid = 'public.rm_reading_stall_check(boolean)'::regprocedure;
-- Forventet: security_definer=t, authenticated_kan_kjore=f, service_kan_kjore=t.
-- 2) Malen fra 20261113 finnes og er aktiv (ellers sendes ingenting).
select template_key, is_active from email_templates where template_key = 'invoice_reading_stopped';
-- 3) Tørrkjøring som root (endrer ingenting): select public.rm_reading_stall_check(true);
-- 4) Tidsplan (bare etter ja): select jobname, schedule from cron.job where jobname = 'rm-lesevarsel-stillstand';

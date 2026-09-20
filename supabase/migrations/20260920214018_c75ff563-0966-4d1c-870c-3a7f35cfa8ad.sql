-- Hemmelige kolonner skal aldri kunne leses gjennom data-APIet, uavhengig av
-- hvilke RLS-policyer som gjelder raden. Kontrollen av PIN og portalpassord
-- skjer i serverfunksjoner som kjører med service_role.
revoke select (pin_hash) on public.pos_operators from anon, authenticated;
revoke select (password_hash, access_token) on public.negotiation_recipients from anon, authenticated;

grant select (pin_hash) on public.pos_operators to service_role;
grant select (password_hash, access_token) on public.negotiation_recipients to service_role;
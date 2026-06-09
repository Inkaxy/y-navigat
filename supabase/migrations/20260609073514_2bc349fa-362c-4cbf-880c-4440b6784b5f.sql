ALTER FUNCTION public.compute_pos_journal_hash() SET search_path TO 'public', 'extensions';
ALTER FUNCTION public.pos_verify_journal_chain(uuid) SET search_path TO 'public', 'extensions';
ALTER FUNCTION public.pos_operator_authenticate(uuid, text, text) SET search_path TO 'public', 'extensions';
ALTER FUNCTION public.pos_set_operator_pin(uuid, text) SET search_path TO 'public', 'extensions';
ALTER FUNCTION public.pos_create_operator(uuid, text, text, text, uuid) SET search_path TO 'public', 'extensions';
ALTER FUNCTION public.set_rfq_password(uuid) SET search_path TO 'public', 'extensions';
ALTER FUNCTION public.negotiation_recipient_by_token(text, text) SET search_path TO 'public', 'extensions';
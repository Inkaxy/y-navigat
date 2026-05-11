ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_outlet_id_fkey;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES public.outlets(id) ON DELETE SET NULL;

ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_legal_entity_id_fkey;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_legal_entity_id_fkey FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE SET NULL;

-- Utvid delivery_rules med nye regeltyper og felter
ALTER TABLE public.delivery_rules
  ALTER COLUMN deadline_time DROP NOT NULL,
  ALTER COLUMN deadline_days_before DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS blackout_from DATE,
  ADD COLUMN IF NOT EXISTS blackout_until DATE,
  ADD COLUMN IF NOT EXISTS specific_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS customer_group_ids UUID[];

-- Drop gammel CHECK på rule_type hvis den finnes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'delivery_rules_rule_type_check'
      AND conrelid = 'public.delivery_rules'::regclass
  ) THEN
    ALTER TABLE public.delivery_rules DROP CONSTRAINT delivery_rules_rule_type_check;
  END IF;
END $$;

ALTER TABLE public.delivery_rules
  ADD CONSTRAINT delivery_rules_rule_type_check
  CHECK (rule_type IN (
    'order_deadline',
    'delivery_weekdays',
    'available_tours',
    'available_products',
    'no_delivery'
  ));

-- Validering per type (trigger, ikke CHECK pga immutability-krav)
CREATE OR REPLACE FUNCTION public.delivery_rules_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.rule_type = 'order_deadline' THEN
    IF NEW.deadline_time IS NULL OR NEW.deadline_days_before IS NULL THEN
      RAISE EXCEPTION 'order_deadline krever deadline_time og deadline_days_before';
    END IF;
  ELSIF NEW.rule_type = 'delivery_weekdays' THEN
    IF NEW.weekdays IS NULL OR array_length(NEW.weekdays, 1) IS NULL THEN
      RAISE EXCEPTION 'delivery_weekdays krever minst én ukedag';
    END IF;
  ELSIF NEW.rule_type = 'available_tours' THEN
    IF NEW.tour_filter IS NULL OR array_length(NEW.tour_filter, 1) IS NULL THEN
      RAISE EXCEPTION 'available_tours krever minst én tur';
    END IF;
  ELSIF NEW.rule_type = 'available_products' THEN
    IF (NEW.product_ids IS NULL OR array_length(NEW.product_ids, 1) IS NULL)
       AND (NEW.product_group_ids IS NULL OR array_length(NEW.product_group_ids, 1) IS NULL) THEN
      RAISE EXCEPTION 'available_products krever minst én vare eller salgsgruppe';
    END IF;
  ELSIF NEW.rule_type = 'no_delivery' THEN
    IF NEW.blackout_from IS NULL OR NEW.blackout_until IS NULL THEN
      RAISE EXCEPTION 'no_delivery krever blackout_from og blackout_until';
    END IF;
    IF NEW.blackout_until < NEW.blackout_from THEN
      RAISE EXCEPTION 'blackout_until må være ≥ blackout_from';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_rules_validate_trg ON public.delivery_rules;
CREATE TRIGGER delivery_rules_validate_trg
BEFORE INSERT OR UPDATE ON public.delivery_rules
FOR EACH ROW EXECUTE FUNCTION public.delivery_rules_validate();

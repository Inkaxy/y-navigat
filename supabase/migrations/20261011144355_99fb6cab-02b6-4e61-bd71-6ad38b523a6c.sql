ALTER TABLE public.raw_material_price_history
  ADD COLUMN IF NOT EXISTS snapshot_unit text,
  ADD COLUMN IF NOT EXISTS snapshot_package jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_currency text,
  ADD COLUMN IF NOT EXISTS snapshot_source text,
  ADD COLUMN IF NOT EXISTS snapshot_at timestamptz;

CREATE OR REPLACE FUNCTION public._rmph_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare v_line uuid; l record; v_bupp numeric; v_corr uuid; v_cur text;
begin
  if tg_op = 'INSERT' then
    select base_unit into new.snapshot_unit from raw_materials where id = new.raw_material_id;
    v_line := coalesce(new.invoice_line_id, new.invoice_line_ref);
    if v_line is not null then
      select il.unit, il.package_size, il.package_unit, il.count_per_package, il.package_source_rms_id, il.updated_at
        into l from invoice_lines il where il.id = v_line;
      if found then
        if l.package_source_rms_id is not null then
          select base_units_per_package into v_bupp from raw_material_suppliers where id = l.package_source_rms_id;
        end if;
        select c.id into v_corr from invoice_line_corrections c where c.invoice_line_id = v_line order by c.corrected_at desc nulls last limit 1;
        new.snapshot_package := jsonb_build_object('line_unit', l.unit, 'package_size', l.package_size, 'package_unit', l.package_unit,
          'count_per_package', l.count_per_package, 'base_units_per_package', v_bupp,
          'line_version', l.updated_at, 'correction_id', v_corr);
      end if;
    end if;
    if new.invoice_id is not null and new.currency is null then select currency into v_cur from invoices where id = new.invoice_id; end if;
    new.snapshot_currency := upper(nullif(btrim(coalesce(new.currency, v_cur)), ''));
    new.snapshot_source := 'ved_registrering';
    new.snapshot_at := now();
    return new;
  end if;
  -- UPDATE: et låst grunnlag er uforanderlig. Tomt grunnlag kan bare fylles av revidert tilbakefylling.
  if old.snapshot_at is not null or coalesce(current_setting('rm.snapshot_backfill', true), '') <> 'on' then
    new.snapshot_unit := old.snapshot_unit; new.snapshot_package := old.snapshot_package;
    new.snapshot_currency := old.snapshot_currency; new.snapshot_source := old.snapshot_source; new.snapshot_at := old.snapshot_at;
  end if;
  return new;
end $f$;
REVOKE ALL ON FUNCTION public._rmph_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rmph_snapshot ON public.raw_material_price_history;
CREATE TRIGGER trg_rmph_snapshot BEFORE INSERT OR UPDATE ON public.raw_material_price_history
  FOR EACH ROW EXECUTE FUNCTION public._rmph_snapshot();

-- Revidert tilbakefylling: bare rader registrert ETTER en revidert enhetsendring får enheten den endringen satte.
DO $b$
begin
  perform set_config('rm.snapshot_backfill', 'on', true);
  update raw_material_price_history h set
    snapshot_unit = s.new_unit, snapshot_source = 'revidert_enhetsbytte', snapshot_at = now()
  from (
    select h2.id, (select al.changes->>'new' from audit_log al
       where al.action = 'raw_material.base_unit_changed' and al.entity_type = 'raw_material'
         and al.entity_id = h2.raw_material_id and al.occurred_at <= h2.created_at
       order by al.occurred_at desc limit 1) as new_unit
    from raw_material_price_history h2 where h2.snapshot_at is null) s
  where s.id = h.id and s.new_unit is not null;
  perform set_config('rm.snapshot_backfill', 'off', true);
end $b$;
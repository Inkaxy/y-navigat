drop trigger if exists trg_invoice_line_match_price_history on public.invoice_lines;
create trigger trg_invoice_line_match_price_history after insert or update of raw_material_id, match_confidence, price_per_base_unit, base_quantity, requires_review, total_amount, review_reason
  on public.invoice_lines for each row execute function public.fn_invoice_line_match_price_history();

do $$
declare d text;
begin
  d := pg_get_functiondef('public.rm_apply_derived_cost_price(uuid)'::regprocedure);
  d := replace(d, '    v_revoked := v_rm.cost_source_history_id is not null and not exists (
      select 1 from raw_material_price_history h where h.id = v_rm.cost_source_history_id
         and h.superseded_at is null and not coalesce(h.is_legacy, false) and not coalesce(h.is_credit, false));',
'    -- Ugyldiggjort = utgått/eldre/kreditert/slettet, eller fakturalinjen stemmer ikke lenger (sum, kobling, leverandør).
    v_revoked := v_rm.cost_source_history_id is not null and not exists (
      select 1 from raw_material_price_history h
        left join invoice_lines il on il.id = h.invoice_line_id
        left join invoices i on i.id = il.invoice_id
       where h.id = v_rm.cost_source_history_id
         and h.superseded_at is null and not coalesce(h.is_legacy, false) and not coalesce(h.is_credit, false)
         and (h.invoice_line_id is null
              or (il.id is not null and il.raw_material_id = h.raw_material_id and h.supplier_id is not distinct from i.supplier_id
                  and public.rm_is_finite(il.total_amount) and il.total_amount > 0 and il.base_quantity > 0
                  and abs(h.price * il.base_quantity - il.total_amount) <= greatest(0.05, 0.01 * il.total_amount))));');
  if position('fakturalinjen stemmer ikke lenger' in d) = 0 then raise exception 'rm_apply_derived_cost_price: ikke funnet'; end if;
  execute d;
end $$;
revoke all on function public.rm_apply_derived_cost_price(uuid) from public, anon, authenticated;
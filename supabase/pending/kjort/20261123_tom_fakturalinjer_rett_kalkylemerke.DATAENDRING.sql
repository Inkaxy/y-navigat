-- =====================================================================================
-- DATAENDRING 23.11.2026 · KJØRT, kjør ikke på nytt
-- Retting etter 20261120_tom_fakturalinjer_for_ehf (kjørt 23.11 etter Henriks ja):
-- de låste kostprisene ble satt inn uten cost_eligible, så 200 råvarer som var «verifisert»
-- falt til «mangler» (prisen var uendret, men kalkylene regnet den ikke som fullstendig).
-- Setter cost_eligible bare på de låste radene for råvarer som var verifisert før tømmingen;
-- utløseren trg_rmph_reapply_cost regner kostprisen på nytt. Kontroll etterpå: 200 verifisert,
-- 0 endrede priser.
-- =====================================================================================
update public.raw_material_price_history h
   set cost_eligible = true
  from public._backup_rm_cost_20261120 b
 where b.id = h.raw_material_id
   and b.cost_basis_status = 'verifisert'
   and h.notes = 'Låst før tømming av fakturalinjer 20.11.2026 (EHF-innlesing)'
   and h.source = 'manual'
   and h.invoice_line_id is null
   and not h.cost_eligible;


alter table public.raw_material_supplier_aliases add column if not exists rejected_at timestamptz;
create index if not exists idx_invoice_lines_requires_review on public.invoice_lines (requires_review) where requires_review = true;
create index if not exists idx_invoice_lines_review_reason on public.invoice_lines (review_reason) where requires_review = true;

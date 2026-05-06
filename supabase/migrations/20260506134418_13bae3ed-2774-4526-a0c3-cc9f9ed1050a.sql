ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_lines_source_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_lines_source_check
  CHECK (lines_source IS NULL OR lines_source = ANY (ARRAY['tripletex_postings','ehf_attachment','manual','pending_manual','pdf_extracted']));
# Fakturaer
- Prissammenligning, prosentavvik, kronevirkning og «Prisen er riktig» på fakturalinjer vises bare når `linePriceGate` (`src/fakturaer/lib/financialPresentation.ts`, speiler live `_rm_queue_line_read_issue`) godkjenner; netto/differanse via `invoiceFigures` (ukjent mva = ukjent netto). Why: kreditnota/valuta/ukontrollert lesing ga falske prisavvik på enkelte flater.
- Originaldokumentet tegnes med PDF.js i appen (`PdfDocumentViewer`, arbeider bygget inn som egen fil), ikke iframe. Why: innebygd PDF-visning ble svart i nettleservinduer.

import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { InvoiceDetailData, InvoiceDetailLine } from "./fetchInvoiceDetail";

/** Bygger MatchDrawer-raden for én linje på fakturadetaljen. */
export function toReviewLineRow(data: InvoiceDetailData, matchLineRaw: InvoiceDetailLine, suggestions: ReviewLineRow["suggestions"]): ReviewLineRow {
  return {
        id: matchLineRaw.id,
        invoice_id: data.id,
        line_number: matchLineRaw.line_number,
        supplier_sku: matchLineRaw.supplier_sku,
        description: matchLineRaw.description,
        quantity: matchLineRaw.quantity,
        unit: matchLineRaw.unit,
        unit_price: matchLineRaw.unit_price,
        total_amount: matchLineRaw.total_amount,
        package_size: matchLineRaw.package_size ?? null,
        package_unit: matchLineRaw.package_unit ?? null,
        count_per_package: matchLineRaw.count_per_package ?? null,
        base_quantity: matchLineRaw.base_quantity ?? null,
        match_confidence: matchLineRaw.match_confidence,
        raw_material_id: matchLineRaw.raw_material_id,
        price_per_base_unit: matchLineRaw.price_per_base_unit,
        expected_price_per_base_unit: matchLineRaw.expected_price_per_base_unit,
        price_variance_pct: matchLineRaw.price_variance_pct,
        variance_status: matchLineRaw.variance_status,
        review_reason: matchLineRaw.review_reason,
        requires_review: matchLineRaw.requires_review ?? null,
        price_reference_source: matchLineRaw.price_reference_source ?? null,
        price_reference_id: matchLineRaw.price_reference_id ?? null,
        price_reference_date: matchLineRaw.price_reference_date ?? null,
        invoice: {
          id: data.id,
          invoice_number: data.invoice_number,
          invoice_date: data.invoice_date,
          legal_entity_id: data.legal_entity_id,
          supplier_id: data.supplier_id,
          status: data.status,
          source: data.source,
          currency: data.currency ?? null,
          is_credit_note: data.is_credit_note ?? null,
          source_document_url: data.source_document_url,
          total_amount: data.total_amount ?? null,
          total_vat: data.total_vat ?? null,
          lines_sum_status: data.lines_sum_status ?? null,
          lines_sum_excl_vat: data.lines_sum_excl_vat ?? null,
          lines_sum_variance_pct: data.lines_sum_variance_pct ?? null,
          extraction_confidence: data.extraction_confidence ?? null,
          supplier: data.suppliers ? { name: data.suppliers.name, contact_email: data.suppliers.contact_email ?? null } : null,
          legal_entity: data.legal_entities ? { legal_name: data.legal_entities.legal_name, short_code: null } : null,
        },

        suggestions,
      }
  };
}

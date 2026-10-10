import { supabase } from "@/integrations/supabase/client";

/** Fakturaen med leverandør, selskap og linjer — kontrakten for ["invoice", id]. */
export async function fetchInvoiceDetail(id: string) {
  const { data, error } = await supabase
    .from("invoices")
    .select("*, suppliers(name, org_number, contact_email), legal_entities(legal_name), invoice_lines(*, raw_materials(id, name, sku))")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export type InvoiceDetailData = Awaited<ReturnType<typeof fetchInvoiceDetail>>;
export type InvoiceDetailLine = InvoiceDetailData["invoice_lines"][number];

import { useEffect, useState } from "react";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";

export interface ReceiptCompany {
  name: string | null;
  org_number: string | null;
  vat_registered: boolean;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface ReceiptOutlet {
  display_number: number | string | null;
  short_name: string | null;
  full_name: string | null;
  phone: string | null;
  address: string | null;
}

export interface ReceiptHeader {
  company: ReceiptCompany | null;
  outlet: ReceiptOutlet | null;
}

/**
 * Fetches static header data (legal entity + outlet) used by the on-screen
 * and printed receipts. Cached per (legalEntityId, outletId) for the lifetime
 * of the page — the data rarely changes.
 */
export function useReceiptHeader(
  legalEntityId: string | null | undefined,
  outletId: string | null | undefined,
): ReceiptHeader {
  const [state, setState] = useState<ReceiptHeader>({
    company: null,
    outlet: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [entityRes, outletRes] = await Promise.all([
        legalEntityId
          ? kioskSupabase
              .from("legal_entities")
              .select(
                "legal_name, display_name, org_number, mva_registered, invoice_address_line1, invoice_address_line2, invoice_postal_code, invoice_city, contact_phone, contact_email",
              )
              .eq("id", legalEntityId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as const),
        outletId
          ? kioskSupabase
              .from("outlets")
              .select(
                "display_number, short_name, full_name, phone, address_line1, postal_code, city",
              )
              .eq("id", outletId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as const),
      ]);

      if (cancelled) return;

      const e = entityRes.data as
        | {
            legal_name: string | null;
            display_name: string | null;
            org_number: string | null;
            mva_registered: boolean | null;
            invoice_address_line1: string | null;
            invoice_address_line2: string | null;
            invoice_postal_code: string | null;
            invoice_city: string | null;
            contact_phone: string | null;
            contact_email: string | null;
          }
        | null;
      const o = outletRes.data as
        | {
            display_number: number | string | null;
            short_name: string | null;
            full_name: string | null;
            phone: string | null;
            address_line1: string | null;
            postal_code: string | null;
            city: string | null;
          }
        | null;

      setState({
        company: e
          ? {
              name: e.display_name ?? e.legal_name,
              org_number: e.org_number,
              vat_registered: !!e.mva_registered,
              address: [
                e.invoice_address_line1,
                e.invoice_address_line2,
                [e.invoice_postal_code, e.invoice_city]
                  .filter(Boolean)
                  .join(" "),
              ]
                .filter((s) => s && String(s).trim().length > 0)
                .join(", "),
              phone: e.contact_phone,
              email: e.contact_email,
            }
          : null,
        outlet: o
          ? {
              display_number: o.display_number,
              short_name: o.short_name,
              full_name: o.full_name,
              phone: o.phone,
              address: [
                o.address_line1,
                [o.postal_code, o.city].filter(Boolean).join(" "),
              ]
                .filter((s) => s && String(s).trim().length > 0)
                .join(", "),
            }
          : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [legalEntityId, outletId]);

  return state;
}

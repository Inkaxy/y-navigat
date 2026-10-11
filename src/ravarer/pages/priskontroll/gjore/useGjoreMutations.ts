import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { invalidateInvoice, invalidateRavarerCounts, invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { parseRematchQueued } from "@/fakturaer/lib/parseRpcJson";
import { changeLinkErrorMessage, claimErrorMessage } from "./logic";
import { parseChangeLinkStrict, parseClaimCredit, type ChangeLinkResult, type ClaimCreditResult } from "./rpc";

import type { Json } from "@/integrations/supabase/types";
import { ClaimSubmitError, claimSubmitCode, claimSubmitError } from "@/ravarer/lib/supplierClaim";

/** Valgt linje med nøyaktig serverkontrollert grunnlag fra rm_supplier_claim_preview. */
type LineRef = { id: string; price_per_base_unit: Json; basis: Json };

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  invalidateInvoice(qc);
  invalidateRavarerCounts(qc);
  void qc.invalidateQueries({ queryKey: ["supplier-items"] });
  void qc.invalidateQueries({ queryKey: ["supplier-item-lines"] });
  void qc.invalidateQueries({ queryKey: ["supplier-cases"] });
  void qc.invalidateQueries({ queryKey: ["audit-history"] });
}

export type ClaimCreditInput = {
  supplierId: string; itemKey: string; lines: LineRef[]; title: string;
  reason?: string | null; responsibleUserId?: string | null; followUpOn?: string | null;
};

/** Godtar prisen (så fakturaen kan avstemmes) og oppretter én sak: dokumentert krav eller prisforespørsel. */
export function useClaimCredit() {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  return useMutation({
    mutationFn: async (i: ClaimCreditInput): Promise<ClaimCreditResult> => {
      if (!company?.id) throw new Error("Fant ikke selskapet.");
      const pLines: Json = i.lines.map((l) => ({ id: l.id, price_per_base_unit: l.price_per_base_unit, basis: l.basis }));
      const { data, error } = await supabase.rpc("rm_supplier_item_claim_credit", {
        p_legal_entity_id: company.id, p_supplier_id: i.supplierId, p_item_key: i.itemKey, p_lines: pLines,
        p_title: i.title, p_reason: i.reason || undefined, p_responsible_user_id: i.responsibleUserId || undefined,
        p_follow_up_on: i.followUpOn || undefined,
      });
      if (error) {
        console.error("[claim-credit]", error);
        throw new ClaimSubmitError(claimSubmitCode(error.message), /claim_|forbidden|linje_allerede/.test(error.message) ? claimSubmitError(error.message) : claimErrorMessage(error.message));
      }
      return parseClaimCredit(data);
    },
    // Også ved feil: grunnlaget kan ha endret seg, så kontrollene hentes på nytt.
    onSettled: () => invalidateAll(qc),
  });
}

export type ChangeLinkInput = { rmsId: string; oldRawMaterialId: string | null; newRawMaterialId: string; reason: string; lineIds: string[] | null };

/** Flytter leverandørkoblingen (og åpne, ikke-førte linjer) til en annen råvare. */
export function useChangeSupplierLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: ChangeLinkInput): Promise<ChangeLinkResult> => {
      let res: { data: unknown; error: { code?: string; message: string } | null };
      try {
        res = await supabase.rpc("rm_change_supplier_link", {
          p_rms_id: i.rmsId, p_new_raw_material_id: i.newRawMaterialId, p_reason: i.reason,
          p_line_ids: i.lineIds ?? undefined,
        });
      } catch (e) {
        // Nettverk/transport: kallet kan ha nådd basen. Ukjent utfall, aldri nytt forsøk.
        console.error("[change-supplier-link] transport", e);
        throw new ChangeLinkUnknownError();
      }
      const { data, error } = res;
      if (error) {
        console.error("[change-supplier-link]", error);
        // Bare en SQL-avvisning (med kode) er en kjent avvisning; uten kode er utfallet ukjent.
        if (!error.code) throw new ChangeLinkUnknownError();
        throw new Error(changeLinkErrorMessage(error.message));
      }
      const parsed = parseChangeLinkStrict(data, i.lineIds);
      if (!parsed) throw new ChangeLinkUnknownError();
      return parsed;
    },
    onError: (e, i) => {
      // Ukjent utfall: koblingen kan være flyttet. Les ferske data; aldri automatisk nytt forsøk.
      if (e instanceof ChangeLinkUnknownError) {
        invalidateAll(qc);
        if (i.oldRawMaterialId) invalidateRawMaterial(qc, i.oldRawMaterialId);
        invalidateRawMaterial(qc, i.newRawMaterialId);
      }
    },
    onSuccess: (_r, i) => {
      invalidateAll(qc);
      if (i.oldRawMaterialId) invalidateRawMaterial(qc, i.oldRawMaterialId);
      invalidateRawMaterial(qc, i.newRawMaterialId);
    },
  });
}

/** «Beregn på nytt» for bestemte fakturaer (etter at avtaleprisen er rettet). */
export function useRematchInvoices() {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  return useMutation({
    mutationFn: async (invoiceIds: string[]) => {
      if (!company?.id) throw new Error("Fant ikke selskapet.");
      const { data, error } = await supabase.rpc("rm_rematch_invoices", {
        p_legal_entity_id: company.id, p_invoice_ids: invoiceIds, p_limit: Math.max(1, invoiceIds.length), p_only_open: true,
      });
      if (error) throw new Error("Kunne ikke legge fakturaene i kø. Prøv igjen.");
      return parseRematchQueued(data);
    },
    onSuccess: () => {
      invalidateRavarerCounts(qc);
      void qc.invalidateQueries({ queryKey: ["rematch-status"] });
    },
  });
}

/** Svaret kunne ikke bekreftes. Koblingen kan være endret; krever ny lesing. */
export class ChangeLinkUnknownError extends Error {
  constructor() { super("Ukjent utfall: koblingen kan være endret. Lukk og kontroller varekortet før du prøver igjen."); }
}

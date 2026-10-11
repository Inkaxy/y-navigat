import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FlagInvoiceDialog } from "@/fakturaer/components/FlagInvoiceDialog";
import { LinkCreditNoteDialog } from "@/fakturaer/components/LinkCreditNoteDialog";
import { ConfirmReconcileDialog } from "@/fakturaer/components/ConfirmReconcileDialog";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { useUnflagInvoice } from "@/ravarer/pages/priskontroll/faktura/useInvoiceActions";

export type DialogState =
  | null
  | { kind: "flag"; ids: string[] }
  | { kind: "unflag"; inv: Pick<InboxInvoice, "id" | "invoice_number"> }
  | { kind: "credit"; inv: Pick<InboxInvoice, "id" | "invoice_number" | "supplier_id" | "legal_entity_id" | "notes"> }
  | { kind: "reconcile"; inv: Pick<InboxInvoice, "id" | "invoice_number" | "assessment"> };

/** Felles dialoger for fakturahandlinger (liste og arbeidsflate). */
export function FakturaerDialogs({ state, onClose, onDone }: { state: DialogState; onClose: () => void; onDone?: (kind: string) => void }) {
  const unflag = useUnflagInvoice();
  return (
    <>
      {state?.kind === "flag" && (
        <FlagInvoiceDialog open onOpenChange={(v) => { if (!v) { onClose(); onDone?.("flag"); } }} invoiceId={state.ids[0]} invoiceIds={state.ids} />
      )}
      <AlertDialog open={state?.kind === "unflag"} onOpenChange={(v) => { if (!v) onClose(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fjerne flagget?</AlertDialogTitle>
            <AlertDialogDescription>
              Faktura {state?.kind === "unflag" ? state.inv.invoice_number : ""} går tilbake til gjennomgang. Begrunnelsen for flagget fjernes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              disabled={unflag.isPending}
              onClick={() => {
                if (state?.kind !== "unflag") return;
                unflag.mutate(state.inv.id, {
                  onSuccess: () => { toast.success("Flagget er fjernet"); onDone?.("unflag"); },
                  onError: (e: Error) => toast.error(e.message),
                });
              }}
            >
              Fjern flagg
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <LinkCreditNoteDialog
        open={state?.kind === "credit"}
        onOpenChange={(v) => { if (!v) onClose(); }}
        creditNote={state?.kind === "credit" ? state.inv : null}
      />
      {state?.kind === "reconcile" && (
        <ConfirmReconcileDialog
          open
          onOpenChange={(v) => { if (!v) onClose(); }}
          invoiceId={state.inv.id}
          invoiceNumber={state.inv.invoice_number}
          reviewLineCount={state.inv.assessment.reviewCount}
          onReconciled={() => onDone?.("reconcile")}
        />
      )}
    </>
  );
}

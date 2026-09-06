import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { showError } from "@/lib/userError";
import { supabase } from "@/integrations/supabase/client";
import { invalidateInvoice } from "@/ravarer/lib/invalidate";
import { formatDate, formatNok } from "@/fakturaer/lib/constants";
import { CREDIT_NOTE_REF_PREFIX, creditNoteOriginalRef } from "@/fakturaer/lib/inbox";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  creditNote: {
    id: string;
    invoice_number: string;
    supplier_id: string;
    legal_entity_id: string;
    notes: string | null;
  } | null;
}

/**
 * Knytter en kreditnota til den opprinnelige fakturaen. Koblingen lagres som
 * en referanse i notatet på kreditnotaen — det er der resten av systemet
 * leser den fra.
 */
export function LinkCreditNoteDialog({ open, onOpenChange, creditNote }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setSelected(creditNoteOriginalRef(creditNote?.notes) ?? "");
  }, [open, creditNote?.notes]);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["credit-note-candidates", creditNote?.supplier_id],
    enabled: open && !!creditNote?.supplier_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, invoice_date, total_amount")
        .eq("legal_entity_id", creditNote!.legal_entity_id)
        .eq("supplier_id", creditNote!.supplier_id)
        .neq("id", creditNote!.id)
        .or("is_credit_note.is.null,is_credit_note.eq.false")
        .order("invoice_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function save() {
    if (!creditNote || !selected) return;
    setBusy(true);
    try {
      const cleaned = (creditNote.notes ?? "")
        .split("\n")
        .filter((l) => !l.trim().toLowerCase().startsWith(CREDIT_NOTE_REF_PREFIX.toLowerCase()))
        .join("\n")
        .trim();
      const notes = [cleaned, `${CREDIT_NOTE_REF_PREFIX} ${selected}`].filter(Boolean).join("\n");
      const { error } = await supabase.from("invoices").update({ notes }).eq("id", creditNote.id);
      if (error) throw error;
      toast.success(`Kreditnotaen er knyttet til faktura ${selected}`);
      invalidateInvoice(qc, creditNote.id);
      onOpenChange(false);
    } catch (e: unknown) {
      showError("kreditnota-kobling", e, "Kunne ikke lagre koblingen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Knytt kreditnota til faktura</DialogTitle>
          <DialogDescription>
            Velg fakturaen kreditnota {creditNote?.invoice_number} hører til.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label className="mb-1.5 block">Opprinnelig faktura</Label>
          <Select value={selected} onValueChange={setSelected} disabled={isLoading}>
            <SelectTrigger>
              <SelectValue placeholder={isLoading ? "Henter fakturaer…" : "Velg faktura…"} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.invoice_number}>
                  {c.invoice_number} · {formatDate(c.invoice_date)} · {formatNok(c.total_amount)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Avbryt
          </Button>
          <Button onClick={() => void save()} disabled={busy || !selected}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Lagre kobling
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

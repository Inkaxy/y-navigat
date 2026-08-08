import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { formatNok } from "@/fakturaer/lib/constants";
import { formatVariancePct } from "@/fakturaer/lib/linesSum";
import { toast } from "sonner";

interface Props {
  invoiceId: string;
  linesSum: number | null;
  totalAmount: number | null;
  totalVat: number | null;
  variancePct: number | null;
  canOverride: boolean;
  onRecheck: () => Promise<void> | void;
  onOverridden: () => void;
}

/**
 * Vises når varelinjene ikke summerer seg til fakturabeløpet.
 * Blokkerer godkjenning til noen har sett på det — brukeren kan overstyre
 * med en begrunnelse som lagres i invoices.notes.
 */
export function LinesSumMismatchAlert({
  invoiceId,
  linesSum,
  totalAmount,
  totalVat,
  variancePct,
  canOverride,
  onRecheck,
  onOverridden,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const expected = totalAmount != null && totalVat != null ? Number(totalAmount) - Number(totalVat) : totalAmount;

  const recheck = async () => {
    setBusy(true);
    try {
      await onRecheck();
    } finally {
      setBusy(false);
    }
  };

  const override = async () => {
    if (!reason.trim()) {
      toast.error("Skriv en kort begrunnelse");
      return;
    }
    setBusy(true);
    try {
      const { data: inv } = await supabase.from("invoices").select("notes").eq("id", invoiceId).maybeSingle();
      const stamp = new Date().toLocaleString("nb-NO");
      const entry = `[${stamp}] Sum-avvik overstyrt: ${reason.trim()}`;
      const notes = inv?.notes ? `${inv.notes}\n${entry}` : entry;
      const { error } = await supabase
        .from("invoices")
        .update({ notes, lines_sum_status: "ok" })
        .eq("id", invoiceId);
      if (error) throw error;
      toast.success("Avviket er overstyrt");
      setShowForm(false);
      setReason("");
      onOverridden();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke overstyre");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="flex-1 space-y-2 text-sm">
          <p className="font-medium text-warning">Varelinjene stemmer ikke med fakturabeløpet</p>
          <p className="text-ink-secondary">
            Varelinjene summerer seg til {formatNok(linesSum)}, fakturaen er på {formatNok(expected)}
            {totalVat != null && totalAmount != null && ` eks. mva (${formatNok(totalAmount)} inkl. mva)`}. Avvik{" "}
            {formatVariancePct(variancePct)}. Det kan mangle linjer. Godkjenning er blokkert til dette er sett på.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={recheck} disabled={busy} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Kontroller på nytt
            </Button>
            {canOverride && !showForm && (
              <Button size="sm" variant="ghost" onClick={() => setShowForm(true)}>
                Overstyr med begrunnelse
              </Button>
            )}
          </div>
          {showForm && (
            <div className="space-y-2 pt-1">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Hvorfor er avviket akseptabelt? (lagres på fakturaen)"
                rows={2}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={override} disabled={busy}>
                  Lagre og lås opp
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowForm(false)} disabled={busy}>
                  Avbryt
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

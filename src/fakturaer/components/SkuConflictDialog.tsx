import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Copy } from "lucide-react";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

export function SkuConflictDialog({ open, onOpenChange, line, onOpenMatchDrawer }: {
  open: boolean; onOpenChange: (v: boolean) => void; line: ReviewLineRow | null; onOpenMatchDrawer: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [showMail, setShowMail] = useState(false);

  // Find existing alias + previous supplier_product_name
  const { data: hist } = useQuery({
    queryKey: ["sku-collision-hist", line?.id],
    enabled: !!line && open,
    queryFn: async () => {
      const { data: rms } = await supabase.from("raw_material_suppliers")
        .select("id, raw_material_id, supplier_product_name, raw_material:raw_materials(name)")
        .eq("supplier_id", line!.invoice.supplier_id)
        .eq("supplier_sku", line!.supplier_sku ?? "");
      if (!rms?.[0]) return null;
      const { data: alias } = await supabase.from("raw_material_supplier_aliases")
        .select("id, match_count")
        .eq("raw_material_supplier_id", rms[0].id)
        .eq("alias_type", "supplier_sku")
        .eq("status", "confirmed").maybeSingle();
      return { rms: rms[0] as any, alias };
    },
  });

  async function keepExisting() {
    if (!line || !hist?.rms) return;
    setBusy(true);
    try {
      await supabase.from("raw_material_suppliers")
        .update({ supplier_product_name: line.description })
        .eq("id", hist.rms.id);
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("raw_material_supplier_aliases").insert({
        raw_material_supplier_id: hist.rms.id, alias_type: "product_name",
        alias_value: line.description ?? "", status: "confirmed",
        confirmed_by: user?.id, confirmed_at: new Date().toISOString(),
      });
      await supabase.from("invoice_lines").update({
        raw_material_id: hist.rms.raw_material_id, match_confidence: "manual",
        requires_review: false, review_reason: null,
        resolved_by: user?.id, resolved_at: new Date().toISOString(),
      }).eq("id", line.id);
      toast.success("Beholdt eksisterende råvare med oppdatert beskrivelse");
      qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] });
      qc.invalidateQueries({ queryKey: ["fakturaer-review-count"] });
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  async function markNewProduct() {
    if (!hist?.alias) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("raw_material_supplier_aliases").update({
        status: "superseded", rejected_reason: "SKU gjenbrukt for ny vare",
        rejected_at: new Date().toISOString(), rejected_by: user?.id,
      }).eq("id", hist.alias.id);
      onOpenChange(false);
      onOpenMatchDrawer();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  if (!line) return null;

  const mailBody = `Hei,\n\nPå faktura ${line.invoice.invoice_number} datert ${line.invoice.invoice_date} har vi mottatt linje med SKU ${line.supplier_sku} og beskrivelse "${line.description}".\n\nTidligere har samme SKU vært "${hist?.rms?.supplier_product_name ?? ""}".\nKan dere bekrefte hva som er korrekt vare?\n\nMvh`;
  const mailto = `mailto:${line.invoice.supplier?.contact_email ?? ""}?subject=${encodeURIComponent(`Avklaring SKU ${line.supplier_sku} – faktura ${line.invoice.invoice_number}`)}&body=${encodeURIComponent(mailBody)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-warning" /> SKU-konflikt</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
            SKU <code>{line.supplier_sku}</code> fra <strong>{line.invoice.supplier?.name}</strong> har historisk matchet
            <strong> {hist?.rms?.raw_material?.name ?? "—"}</strong> ({hist?.alias?.match_count ?? 0}x).<br />
            Ny linje: «{line.description}»<br />
            Forrige beskrivelse: «{hist?.rms?.supplier_product_name ?? "—"}»
          </div>
          <div className="space-y-2 pt-2">
            <Button className="w-full justify-start" variant="outline" onClick={keepExisting} disabled={busy}>
              Det er fortsatt {hist?.rms?.raw_material?.name ?? "samme råvare"} (omdøpt)
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={markNewProduct} disabled={busy}>
              Det er en ny vare → finn / opprett råvare
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => setShowMail((v) => !v)}>
              Send oppfølging til leverandør
            </Button>
          </div>
          {showMail && (
            <div className="space-y-2 rounded-lg border border-line-subtle p-3">
              <Textarea readOnly value={mailBody} rows={8} className="font-mono text-xs" />
              <div className="flex gap-2">
                <Button size="sm" asChild><a href={mailto}>Åpne i e-post</a></Button>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(mailBody); toast.success("Kopiert"); }}>
                  <Copy className="h-3.5 w-3.5" /> Kopier
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Lukk</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

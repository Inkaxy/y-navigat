import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

const REASONS = ["Frakt", "Miljø-/palleavgift", "Servicegebyr", "Rabatt", "Pant", "Annet"];

export function NotARawMaterialDialog({ open, onOpenChange, line }: { open: boolean; onOpenChange: (v: boolean) => void; line: ReviewLineRow | null }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("Frakt");
  const [other, setOther] = useState("");
  const [remember, setRemember] = useState(true);
  const [patternType, setPatternType] = useState<string>("exact_sku");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !line) return;
    setReason("Frakt"); setOther(""); setRemember(true);
    setPatternType(line.supplier_sku ? "exact_sku" : "exact_description");
  }, [open, line?.id]);

  async function submit() {
    if (!line) return;
    const finalReason = reason === "Annet" ? other.trim() : reason;
    if (!finalReason) { toast.error("Angi grunn"); return; }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const nowIso = new Date().toISOString();

      await supabase.from("invoice_lines").update({
        match_confidence: "not_applicable", requires_review: false, review_reason: null,
        resolution_note: finalReason, resolved_by: user?.id, resolved_at: nowIso,
      }).eq("id", line.id);

      if (remember) {
        const patternValue = patternType === "exact_sku" ? line.supplier_sku
          : patternType === "exact_description" ? line.description
          : (line.description ?? "").split(/\s+/).slice(0, 3).join(" ");
        if (patternValue) {
          await supabase.from("invoice_line_exclusion_patterns").insert({
            legal_entity_id: line.invoice.legal_entity_id, supplier_id: line.invoice.supplier_id,
            pattern_type: patternType, pattern_value: patternValue, reason: finalReason, created_by: user?.id,
          });
        }
      }

      toast.success("Markert som ikke-råvare");
      qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] });
      qc.invalidateQueries({ queryKey: ["fakturaer-review-count"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Feil");
    } finally { setBusy(false); }
  }

  if (!line) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Ikke en råvare</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Grunn</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {reason === "Annet" && (
            <div>
              <Label className="mb-1.5 block">Spesifiser</Label>
              <Input value={other} onChange={(e) => setOther(e.target.value)} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
            Husk dette for fremtidige fakturaer fra {line.invoice.supplier?.name}
          </label>
          {remember && (
            <RadioGroup value={patternType} onValueChange={setPatternType} className="space-y-1.5 rounded-lg border border-line-subtle p-3 text-sm">
              {line.supplier_sku && (
                <label className="flex items-center gap-2"><RadioGroupItem value="exact_sku" /> Eksakt SKU «{line.supplier_sku}»</label>
              )}
              <label className="flex items-center gap-2"><RadioGroupItem value="exact_description" /> Eksakt beskrivelse</label>
              <label className="flex items-center gap-2"><RadioGroupItem value="description_contains" /> Beskrivelse inneholder «{(line.description ?? "").split(/\s+/).slice(0, 3).join(" ")}»</label>
            </RadioGroup>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Avbryt</Button>
          <Button onClick={submit} disabled={busy}>Marker som ikke-råvare</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

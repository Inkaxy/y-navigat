import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Radio } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useCreateNegotiation } from "@/ravarer/hooks/useNegotiations";
import { useLogLiveEvent } from "@/ravarer/hooks/useLiveNegotiation";

export default function LiveForhandlingSetup() {
  const navigate = useNavigate();
  const { user } = useRavarer();
  const { data: suppliers = [] } = useSuppliers();
  const { data: rawMaterials = [] } = useRawMaterials();
  const createNeg = useCreateNegotiation();
  const logEvent = useLogLiveEvent();

  const [supplierId, setSupplierId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<"physical" | "video" | "phone">("physical");
  const [notes, setNotes] = useState("");
  const [preload, setPreload] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const supplier = suppliers.find((s) => s.id === supplierId);

  // Find raw materials linked to this supplier
  const supplierRawMaterials = useMemo(() => {
    return [] as { id: string }[]; // populated below via async query at submit time
  }, [supplierId]);

  function autoTitle(name: string) {
    const q = Math.floor(new Date().getMonth() / 3) + 1;
    const y = new Date().getFullYear();
    return `Q${q} ${y} reforhandling ${name}`;
  }

  async function handleStart() {
    if (!supplierId || !title.trim()) {
      toast.error("Velg leverandør og angi tittel");
      return;
    }
    setSubmitting(true);
    try {
      // Find raw materials for this supplier (active)
      let rmIds: string[] = [];
      if (preload) {
        const { data, error } = await supabase
          .from("raw_material_suppliers")
          .select("raw_material_id, raw_materials!inner(is_active)")
          .eq("supplier_id", supplierId);
        if (error) throw error;
        rmIds = (data ?? [])
          .filter((r: any) => r.raw_materials?.is_active)
          .map((r: any) => r.raw_material_id);
      }

      const neg = await createNeg.mutateAsync({
        title: title.trim(),
        purpose: notes.trim() || null,
        notes: notes.trim() || null,
        status: "in_progress",
        negotiation_mode: "live",
        live_session_started_at: new Date().toISOString(),
        live_facilitator_id: user?.id ?? null,
        live_location_format: format,
      } as any);

      // Insert single recipient (this supplier)
      await supabase.from("negotiation_recipients" as any).insert({
        negotiation_id: neg.id,
        supplier_id: supplierId,
        contact_email: supplier?.contact_email ?? null,
        contact_name: supplier?.name ?? null,
      } as any);

      // Insert pre-loaded items as discussing? Per spec: "venter diskusjon" => pending
      if (rmIds.length > 0) {
        const rows = rmIds.map((id, idx) => ({
          negotiation_id: neg.id,
          raw_material_id: id,
          sort_order: idx,
          live_status: "pending",
        }));
        const { error } = await supabase.from("negotiation_items" as any).insert(rows as any);
        if (error) throw error;
      }

      await logEvent.mutateAsync({
        negotiation_id: neg.id,
        event_type: "session_started",
        event_data: { format, supplier_id: supplierId, preloaded_count: rmIds.length },
      });

      navigate(`/ravarer/forhandlinger/live/${neg.id}`);
    } catch (e: any) {
      toast.error(`Kunne ikke starte: ${e.message ?? e}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/ravarer/forhandlinger")}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Forhandlinger
      </Button>

      <Card className="space-y-5 p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-warning/15 text-warning">
            <Radio className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Start live forhandling</h1>
            <p className="text-sm text-ink-secondary">Over bordet — sanntidsregistrering</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Leverandør</Label>
          <Select
            value={supplierId}
            onValueChange={(v) => {
              setSupplierId(v);
              const s = suppliers.find((x) => x.id === v);
              if (s && !title) setTitle(autoTitle(s.name));
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Velg leverandør" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Tittel</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="F.eks. Q1 2026 reforhandling" />
        </div>

        <div className="space-y-2">
          <Label>Sted/format</Label>
          <RadioGroup value={format} onValueChange={(v: any) => setFormat(v)} className="flex gap-4">
            {[
              { v: "physical", l: "Fysisk møte" },
              { v: "video", l: "Video" },
              { v: "phone", l: "Telefon" },
            ].map((o) => (
              <label key={o.v} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={o.v} id={`fmt-${o.v}`} />
                {o.l}
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label>Notater</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Bakgrunn, agenda, deltakere…"
            rows={3}
          />
        </div>

        <label className="flex items-start gap-2 rounded-md border border-line-subtle p-3 text-sm">
          <Checkbox checked={preload} onCheckedChange={(v) => setPreload(!!v)} className="mt-0.5" />
          <div>
            <p className="font-medium">Forhåndslast aktive råvarer fra leverandøren</p>
            <p className="text-xs text-ink-secondary">Lastes som "venter diskusjon" så du raskt kan jobbe gjennom dem.</p>
          </div>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => navigate("/ravarer/forhandlinger")}>
            Avbryt
          </Button>
          <Button onClick={handleStart} disabled={submitting || !supplierId || !title.trim()}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Start forhandling →
          </Button>
        </div>
      </Card>
    </div>
  );
}

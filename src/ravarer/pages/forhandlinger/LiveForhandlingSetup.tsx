import { showError } from "@/lib/userError";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { paths } from "@/ravarer/lib/paths";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";

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
  const lock = useRef(false);
  const rights = useInvoiceRights();

  const supplier = suppliers.find((s) => s.id === supplierId);
  const hiddenSupplierCount = useMemo(
    () => suppliers.filter((s) => s.is_active && !s.track_invoice_lines).length,
    [suppliers],
  );

  function autoTitle(name: string) {
    const q = Math.floor(new Date().getMonth() / 3) + 1;
    const y = new Date().getFullYear();
    return `Q${q} ${y} reforhandling ${name}`;
  }

  async function handleStart() {
    if (lock.current) return;
    if (!supplierId || !title.trim()) {
      toast.error("Velg leverandør og angi tittel");
      return;
    }
    lock.current = true;
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
          .filter((r) => r.raw_materials?.is_active)
          .map((r) => r.raw_material_id);
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
      });

      // Insert single recipient (this supplier)
      // access_token settes av triggeren trg_neg_recipients_token; generert type krever den likevel.
      // @ts-expect-error generert Insert-type mangler standardverdi for access_token
      const { error: recErr } = await supabase.from("negotiation_recipients").insert({
        negotiation_id: neg.id,
        supplier_id: supplierId,
        contact_email: supplier?.contact_email ?? null,
        contact_name: supplier?.name ?? null,
      });
      if (recErr) {
        // Forhandlingen er opprettet, men leverandøren mangler. Gå til arbeidsflaten
        // i stedet for å starte en ny (som ville gitt en duplikat).
        showError("live-forhandling:mottaker", recErr, "Forhandlingen er opprettet, men leverandøren ble ikke lagt til. Kontroller den før du fortsetter.");
        navigate(paths.liveForhandling(neg.id));
        return;
      }

      // Insert pre-loaded items as discussing? Per spec: "venter diskusjon" => pending
      if (rmIds.length > 0) {
        const rows = rmIds.map((id, idx) => ({
          negotiation_id: neg.id,
          raw_material_id: id,
          sort_order: idx,
          live_status: "pending",
        }));
        const { error } = await supabase.from("negotiation_items").insert(rows);
        if (error) throw error;
      }

      await logEvent.mutateAsync({
        negotiation_id: neg.id,
        event_type: "session_started",
        event_data: { format, supplier_id: supplierId, preloaded_count: rmIds.length },
      });

      navigate(paths.liveForhandling(neg.id));
    } catch (e: unknown) {
      showError("live-forhandling:start", e, "Kunne ikke starte forhandlingen. Prøv igjen.");
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => navigate(paths.forhandlinger())}>
        <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Forhandlinger
      </Button>
      <ModulePage eyebrow="Live-forhandling" title="Start live-forhandling" subtitle="Over bordet — registrer avtaler mens dere snakker" icon={Radio} embedsPage={false}>
      {!rights.loading && !rights.canWrite && (
        <p role="status" className="rounded-md border border-line-subtle bg-surface-muted p-3 text-sm text-ink-secondary">
          Du har lesetilgang. Å starte en forhandling krever skrivetilgang til fakturaer i Råvarer.
        </p>
      )}
      <Card className="space-y-5 p-4 sm:p-6">

        <div className="space-y-2">
          <Label htmlFor="live-sup">Leverandør</Label>
          <Select
            value={supplierId}
            onValueChange={(v) => {
              setSupplierId(v);
              const s = suppliers.find((x) => x.id === v);
              if (s && !title) setTitle(autoTitle(s.name));
            }}
          >
            <SelectTrigger id="live-sup" className="min-h-[44px]">
              <SelectValue placeholder="Velg leverandør" />
            </SelectTrigger>
            <SelectContent>
              {/* Bare leverandører med «Følg fakturalinjer» er med: forhandling bygger på
fakturahistorikk, og uten den finnes verken volum eller prisgrunnlag. */}
              {suppliers.filter((s) => s.is_active && s.track_invoice_lines).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-ink-secondary">
            Bare aktive leverandører merket med «Følg fakturalinjer» kan velges — forhandlingen
            trenger fakturahistorikken for å vise volum og priser.
          </p>
          {hiddenSupplierCount > 0 && (
            <p className="text-xs text-ink-secondary">
              {hiddenSupplierCount} leverandører uten «Følg fakturalinjer» vises ikke – slå på under{" "}
              <Link to={paths.leverandorer()} className="underline">
                Leverandører
              </Link>
              .
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="live-title">Tittel</Label>
          <Input id="live-title" className="min-h-[44px]" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="F.eks. Q1 2026 reforhandling" />
        </div>

        <div className="space-y-2">
          <Label>Sted/format</Label>
          <RadioGroup value={format} onValueChange={(v) => { if (v === "physical" || v === "video" || v === "phone") setFormat(v); }} className="flex flex-wrap gap-x-4">
            {[
              { v: "physical", l: "Fysisk møte" },
              { v: "video", l: "Video" },
              { v: "phone", l: "Telefon" },
            ].map((o) => (
              <label key={o.v} className="flex min-h-[44px] items-center gap-2 text-sm">
                <RadioGroupItem value={o.v} id={`fmt-${o.v}`} />
                {o.l}
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="live-notes">Notater</Label>
          <Textarea
            id="live-notes"
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
            <p className="text-xs text-ink-secondary">Lastes som «ikke startet» så du raskt kan jobbe gjennom dem.</p>
          </div>
        </label>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="outline" className="min-h-[44px]" onClick={() => navigate(paths.forhandlinger())}>
            Avbryt
          </Button>
          <Button className="min-h-[44px]" onClick={handleStart} disabled={!rights.canWrite || submitting || !supplierId || !title.trim()}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Start forhandling
          </Button>
        </div>
      </Card>
      </ModulePage>
    </div>
  );
}

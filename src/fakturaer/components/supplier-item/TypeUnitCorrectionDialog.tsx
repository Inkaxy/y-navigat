import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { ITEM_TYPES, itemTypeLabel, type ItemType } from "@/ravarer/lib/itemTypes";
import { cn } from "@/lib/utils";
import {
  blockerText, parseTypeUnitApply, parseTypeUnitPreview, REJECTION_TEXT, type TypeUnitApply,
} from "@/fakturaer/lib/typeUnitCorrection";

export interface FrozenRequest {
  opId: string;
  companyId: string;
  args: { p_raw_material_id: string; p_item_type: string; p_base_unit: string; p_reason: string; p_expected_updated_at: string; p_op_id: string; p_dry_run: false };
}

const BASE_UNITS = ["kg", "l", "stk"] as const;
type BaseUnit = (typeof BASE_UNITS)[number];

interface Props {
  /** Selskapet dialogen er åpnet i. Frosset ved montering; bytte avmonterer via key i forelder. */
  companyId: string;
  rawMaterialId: string;
  rawMaterialName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canWrite: boolean;
  /** Kalles etter bekreftet lagring (serverens kvittering). */
  onSaved?: (r: Extract<TypeUnitApply, { kind: "saved" }>) => void;
  initialItemType?: ItemType;
  initialBaseUnit?: BaseUnit;
}

/** «Rett varetype og måleenhet» — forhåndsvisning fra serveren, deretter én atomisk lagring. */
export function TypeUnitCorrectionDialog(props: Props) {
  const qc = useQueryClient();
  // Frosset kontekst: selskap + vare + navn låses ved montering. Forelderens bytte (annen vare/selskap)
  // endrer aldri hva en pågående eller uavklart lagring sender.
  const frozen = useRef({ companyId: props.companyId, rawMaterialId: props.rawMaterialId, rawMaterialName: props.rawMaterialName }).current;
  const contextChanged = props.companyId !== frozen.companyId || props.rawMaterialId !== frozen.rawMaterialId;
  const p = { ...props, ...frozen };
  const [itemType, setItemType] = useState<ItemType | null>(p.initialItemType ?? null);
  const [baseUnit, setBaseUnit] = useState<BaseUnit | null>(p.initialBaseUnit ?? null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<TypeUnitApply | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  /** Frosset forespørsel til utfallet er kjent: «Prøv igjen» sender nøyaktig samme payload og opId. */
  const pending = useRef<FrozenRequest | null>(null);

  const current = useQuery({
    queryKey: ["rm-type-unit-current", p.companyId, p.rawMaterialId],
    enabled: p.open,
    queryFn: async () => {
      const { data, error } = await supabase.from("raw_materials").select("id, item_type, base_unit, legal_entity_id").eq("id", p.rawMaterialId).eq("legal_entity_id", p.companyId).maybeSingle();
      if (error || !data) throw new Error("Kunne ikke hente varen");
      return data;
    },
  });
  const it = itemType ?? (current.data?.item_type as ItemType | undefined) ?? null;
  const bu = baseUnit ?? (current.data?.base_unit as BaseUnit | undefined) ?? null;

  const preview = useQuery({
    queryKey: ["rm-type-unit-preview", p.companyId, p.rawMaterialId, it, bu],
    enabled: p.open && !!it && !!bu && p.canWrite && !pending.current,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rm_correct_raw_material_type_unit", {
        p_raw_material_id: p.rawMaterialId, p_item_type: it!, p_base_unit: bu!, p_reason: "", p_expected_updated_at: "", p_op_id: crypto.randomUUID(), p_dry_run: true,
      });
      if (error) throw new Error("Kunne ikke kontrollere konsekvensene");
      const parsed = parseTypeUnitPreview(data, p.rawMaterialId);
      if (!parsed) throw new Error("Uventet svar fra kontrollen");
      return parsed;
    },
  });

  const pv = preview.data;
  const changes = !!pv && (pv.unitChanges || pv.typeChanges);
  const blocked = !!pv && pv.unitChanges && pv.blockers.length > 0;
  const unknown = outcome?.kind === "unknown";
  const canSave = p.canWrite && !contextChanged && !!pv && changes && !blocked && reason.trim().length >= 5 && !saving && !preview.isFetching && outcome?.kind !== "saved";

  /** Første lagring fryser payload; uavklart utfall sender bare den frosne forespørselen på nytt. */
  const save = async (mode: "new" | "retry") => {
    if (lock.current) return;
    if (mode === "new") {
      if (!pv || !it || !bu || !canSave || pending.current) return;
      const opId = crypto.randomUUID();
      pending.current = { opId, companyId: p.companyId, args: {
        p_raw_material_id: p.rawMaterialId, p_item_type: it, p_base_unit: bu, p_reason: reason.trim(),
        p_expected_updated_at: pv.updatedAt, p_op_id: opId, p_dry_run: false } };
    }
    const req = pending.current;
    if (!req) return;
    lock.current = true; setSaving(true);
    const r = await sendFrozen(req);
    if (r.kind !== "unknown") pending.current = null;
    setOutcome(r);
    setSaving(false); lock.current = false;
    if (r.kind === "saved") {
      void qc.invalidateQueries({ queryKey: ["rm-type-unit-current", p.companyId, p.rawMaterialId] });
      void qc.invalidateQueries({ queryKey: ["supplier-items"] });
      void qc.invalidateQueries({ queryKey: ["supplier-item-lines"] });
      void qc.invalidateQueries({ queryKey: ["material-choice"] });
      void qc.invalidateQueries({ queryKey: ["raw-materials"] });
      p.onSaved?.(r);
    } else if (r.kind === "rejected" && r.error === "versjon_endret") {
      void preview.refetch();
    }
  };

  return (
    <Dialog open={p.open} onOpenChange={(o) => { if (!saving && !unknown) p.onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rett varetype og måleenhet</DialogTitle>
          <DialogDescription>{p.rawMaterialName}. Gjelder varen i hele selskapet, ikke bare denne fakturaen.</DialogDescription>
        </DialogHeader>

        {current.isError && <p role="alert" className="text-sm text-destructive">Kunne ikke hente varen. <Button variant="link" className="h-auto p-0" onClick={() => void current.refetch()}>Prøv igjen</Button></p>}
        {current.data && (
          <p className="text-caption text-ink-secondary">Registrert nå: {itemTypeLabel(current.data.item_type)} · grunnenhet {current.data.base_unit ?? "ukjent"}</p>
        )}

        <fieldset className="space-y-1" disabled={saving || unknown || outcome?.kind === "saved"}>
          <legend className="text-caption font-medium">Varetype</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {ITEM_TYPES.map((t) => (
              <button key={t.value} type="button" aria-pressed={it === t.value} onClick={() => { setItemType(t.value); setOutcome(null); }}
                className={cn("min-h-[44px] rounded-md border px-2 py-1.5 text-left text-sm", it === t.value ? "border-primary bg-primary/5" : "border-line-subtle hover:bg-muted/40")}>
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-1" disabled={saving || unknown || outcome?.kind === "saved"}>
          <legend className="text-caption font-medium">Grunnenhet (det oppskrifter og kostpris regnes i)</legend>
          <div className="grid grid-cols-3 gap-1.5">
            {BASE_UNITS.map((u) => (
              <button key={u} type="button" aria-pressed={bu === u} onClick={() => { setBaseUnit(u); setOutcome(null); }}
                className={cn("min-h-[44px] rounded-md border px-2 text-sm", bu === u ? "border-primary bg-primary/5" : "border-line-subtle hover:bg-muted/40")}>
                {u}
              </button>
            ))}
          </div>
          <p className="text-caption text-ink-secondary">Pose, sekk og kartong er innkjøpsbeholdere, ikke grunnenhet. En pose på 100 g har grunnenhet kg.</p>
        </fieldset>

        <section aria-label="Konsekvenser" className="space-y-1 rounded-md border border-line-subtle p-3 text-sm">
          {preview.isLoading && <p className="flex items-center gap-2 text-ink-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Kontrollerer konsekvenser …</p>}
          {preview.isError && <p role="alert" className="text-destructive">Kunne ikke kontrollere konsekvensene; lagring er sperret. <Button variant="link" className="h-auto p-0" onClick={() => void preview.refetch()}>Prøv igjen</Button></p>}
          {pv && !changes && <p className="text-ink-secondary">Ingen endring valgt.</p>}
          {pv && changes && (
            <ul className="list-disc space-y-0.5 pl-4">
              {pv.typeChanges && <li>Varetype endres fra {itemTypeLabel(pv.from.itemType)} til {itemTypeLabel(it)}.</li>}
              {pv.unitChanges && <li>Grunnenhet endres fra {pv.from.baseUnit} til {bu}.</li>}
              {pv.unitChanges && pv.packageConfirmationsToReset > 0 && <li>{pv.packageConfirmationsToReset} bekreftet pakning i {pv.from.baseUnit} gjelder ikke lenger og må bekreftes på nytt (beholdes i historikken).</li>}
              {pv.unitChanges && pv.priceHistoryToSupersede > 0 && <li>{pv.priceHistoryToSupersede} tidligere prisobservasjon(er) teller ikke lenger som kostgrunnlag. De slettes ikke og endres ikke.</li>}
              {pv.unitChanges && pv.compatibleRecipeLines > 0 && <li>{pv.compatibleRecipeLines} oppskriftslinje(r) er allerede i vekt/volum og passer. Mengdene endres ikke.</li>}
              {pv.unitChanges && pv.openInvoices > 0 && <li>{pv.openInvoices} åpen(e) faktura(er) kontrolleres på nytt. Ingenting godkjennes automatisk.</li>}
              {pv.unitChanges && pv.approvedInvoicesSkipped > 0 && <li>{pv.approvedInvoicesSkipped} internt godkjent(e) faktura(er) kontrolleres ikke på nytt og endres ikke.</li>}
            </ul>
          )}
          {pv && blocked && (
            <div role="alert" className="space-y-1 text-destructive">
              {pv.blockers.map((b, i) => <p key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{blockerText(b)}</p>)}
            </div>
          )}
        </section>

        <div>
          <Label htmlFor="tu-reason" className="text-caption">Begrunnelse (påkrevd)</Label>
          <Textarea id="tu-reason" value={reason} disabled={saving || unknown || outcome?.kind === "saved"} onChange={(e) => setReason(e.target.value)} placeholder="F.eks. Leveres i poser à 100 gram, brukes i gram i oppskrifter" />
        </div>

        {outcome?.kind === "saved" && (
          <p role="status" className="text-sm">
            Lagret: {itemTypeLabel(outcome.itemType)} · grunnenhet {outcome.baseUnit}.
            {outcome.packageConfirmationsReset > 0 ? ` Pakningen må bekreftes på nytt i ${outcome.baseUnit}.` : ""}
            {outcome.openInvoicesRequeued != null && outcome.openInvoicesRequeued > 0 ? ` ${outcome.openInvoicesRequeued} faktura(er) kontrolleres på nytt.` : ""}
          </p>
        )}
        {outcome?.kind === "rejected" && <p role="alert" className="text-sm text-destructive">{REJECTION_TEXT[outcome.error] ?? "Avvist."}</p>}
        {unknown && <p role="alert" className="text-sm text-destructive">Utfallet er ukjent. Trykk «Prøv igjen» – samme forespørsel sendes, så den kan ikke lagres to ganger.</p>}
        {contextChanged && !unknown && <p role="alert" className="text-sm text-destructive">Valgt vare eller selskap er endret. Lukk og åpne rettingen på nytt for den nye varen.</p>}
        {outcome?.kind === "saved" && outcome.approvedInvoicesSkipped ? <p className="text-caption text-ink-secondary">{outcome.approvedInvoicesSkipped} internt godkjent(e) faktura(er) ble ikke kontrollert på nytt og er uendret.</p> : null}
        {!p.canWrite && <p className="text-caption text-ink-secondary">Du har bare lesetilgang.</p>}

        <DialogFooter>
          {outcome?.kind === "saved"
            ? <Button onClick={() => p.onOpenChange(false)}>Fortsett til pakning</Button>
            : <>
                <Button variant="outline" disabled={saving || unknown} onClick={() => p.onOpenChange(false)}>Avbryt</Button>
                <Button onClick={() => void save(unknown ? "retry" : "new")} disabled={unknown ? saving : !canSave}>
                  {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}{unknown ? "Prøv igjen" : "Lagre retting"}
                </Button>
              </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Sender en frosset forespørsel uendret. Nettverks-/ukjent svar gir «unknown», aldri suksess. */
export async function sendFrozen(req: FrozenRequest): Promise<TypeUnitApply> {
  try {
    const { data, error } = await supabase.rpc("rm_correct_raw_material_type_unit", req.args);
    return error ? { kind: "unknown" } : parseTypeUnitApply(data, req.args.p_raw_material_id);
  } catch { return { kind: "unknown" }; }
}

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SALES_UNIT_BASIS_HELP, SALES_UNIT_BASIS_LABEL, isSalesUnitBasis, type SalesUnitBasis } from "@/varer/lib/recipeLinkBasis";
import { linkWriteMessage, type LinkBase, type LinkWriteResult } from "@/varer/lib/recipeLinkWrite";

export interface SalesUnitValues {
  sales_unit_basis: SalesUnitBasis | null;
  units_per_sales_unit: number | null;
  sales_unit_weight_g: number | null;
  units_per_batch_override: number | null;
}

interface Draft { key: string; base: LinkBase | null; basis: SalesUnitBasis | ""; units: string; weight: string; batch: string }

/** Identitet for en akseptert serverversjon: kobling, oppskrift, rå token og nøyaktige innstillinger. */
export function baseKey(b: LinkBase | null): string {
  return b ? JSON.stringify([b.productId, b.linkId, b.recipeId, b.updatedAt, b.settings]) : "none";
}
const str = (v: string | number | null) => (v == null ? "" : String(v));
function hydrate(b: LinkBase | null): Draft {
  const s = b?.settings;
  return {
    key: baseKey(b), base: b,
    basis: s && isSalesUnitBasis(s.sales_unit_basis) ? (s.sales_unit_basis as SalesUnitBasis) : "",
    units: s ? str(s.units_per_sales_unit) : "",
    weight: s ? str(s.sales_unit_weight_g) : "",
    batch: s ? str(s.units_per_batch_override) : "",
  };
}

function formatTimestamp(value: string | number | null | undefined): string {
  if (typeof value !== "string" || !value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("nb-NO", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Koblingens salgsenhet. Kladden eier sin aksepterte basis: ren kladd følger ny serverversjon,
 * endret kladd mot ny versjon vises som konflikt og lagres aldri med ny token. Etter bekreftet
 * oppskriftsbytte (`resetSignal`) hydreres kladden fra den nye raden.
 */
export function SalesUnitSettings({ base, canWrite, pending, resetSignal, onSave }: {
  base: LinkBase | null;
  canWrite: boolean;
  pending: boolean;
  resetSignal: number;
  onSave: (frozen: LinkBase, values: SalesUnitValues) => Promise<LinkWriteResult>;
}) {
  const [draft, setDraft] = useState<Draft>(() => hydrate(base));
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const gen = useRef(0);
  const incomingKey = baseKey(base);
  const lastReset = useRef(resetSignal);

  useEffect(() => {
    if (lastReset.current !== resetSignal) {
      lastReset.current = resetSignal;
      gen.current += 1;
      setDraft(hydrate(base)); setDirty(false); setNotice(null);
      return;
    }
    if (!dirty) { setDraft((d) => (d.key === incomingKey ? d : hydrate(base))); return; }
    // Endret kladd + ny serverversjon: behold kladden, vis konflikt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingKey, resetSignal]);

  const conflict = dirty && draft.key !== incomingKey;
  const edit = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); setNotice(null); };
  const editable = canWrite && !!draft.base && !pending;

  async function save() {
    const frozen = draft.base;
    if (!frozen || conflict || pending || !draft.basis) return;
    const values: SalesUnitValues = {
      sales_unit_basis: draft.basis,
      units_per_sales_unit: draft.basis === "vekt" ? null : draft.units === "" ? (draft.basis === "stk" ? 1 : null) : Number(draft.units),
      sales_unit_weight_g: draft.weight === "" ? null : Number(draft.weight),
      units_per_batch_override: draft.batch === "" ? null : Number(draft.batch),
    };
    const myGen = gen.current;
    const res = await onSave(frozen, values);
    if (myGen !== gen.current) return; // Sen fullføring for en annen kladd/oppskrift.
    if (res.kind === "saved") {
      gen.current += 1;
      const next: LinkBase = { productId: res.row.product_id, linkId: res.row.id, recipeId: res.row.recipe_id, updatedAt: res.row.updated_at, settings: res.row.settings };
      setDraft(hydrate(next)); setDirty(false); setNotice(null);
      return;
    }
    setNotice(linkWriteMessage(res));
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Koblingens innstillinger</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Bekreft hvordan oppskriftens utbytte svarer til varens salgsenhet. Ingenting utledes fra varenavnet.
          {base?.settings.sales_unit_confirmed_at ? ` Sist bekreftet ${formatTimestamp(base.settings.sales_unit_confirmed_at)}.` : " Ikke bekreftet ennå."}
        </p>
        {!base && canWrite && (
          <p role="status" className="text-xs text-muted-foreground">Innstillingene kan ikke lagres for denne koblingen (gammel direktekobling eller ufullstendig lesing). Bytt oppskrift eller last inn på nytt.</p>
        )}
        {conflict && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <span>Koblingen er endret siden du begynte å redigere. Kladden din er beholdt, men kan ikke lagres mot den nye versjonen.</span>
            <Button size="sm" variant="outline" onClick={() => { gen.current += 1; setDraft(hydrate(base)); setDirty(false); setNotice(null); }}>Forkast kladd og last inn gjeldende</Button>
          </div>
        )}
        {notice && <p role="alert" className="text-xs text-destructive">{notice}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Grunnlag</Label>
            <Select value={draft.basis} onValueChange={(v) => edit({ basis: v as SalesUnitBasis })} disabled={!editable}>
              <SelectTrigger aria-label="Grunnlag for salgsenhet"><SelectValue placeholder="Velg grunnlag" /></SelectTrigger>
              <SelectContent>
                {(["stk", "flerpakk", "vekt"] as SalesUnitBasis[]).map((b) => <SelectItem key={b} value={b}>{SALES_UNIT_BASIS_LABEL[b]}</SelectItem>)}
              </SelectContent>
            </Select>
            {draft.basis ? <p className="text-[11px] text-muted-foreground">{SALES_UNIT_BASIS_HELP[draft.basis]}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="settings-units">Enheter per salgsenhet</Label>
            <Input id="settings-units" inputMode="decimal" value={draft.units} onChange={(e) => edit({ units: e.target.value })} disabled={!editable || draft.basis === "vekt"} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="settings-weight">Vekt per salgsenhet (g)</Label>
            <Input id="settings-weight" inputMode="decimal" value={draft.weight} onChange={(e) => edit({ weight: e.target.value })} disabled={!editable} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="settings-batch">Emner per batch (overstyrt)</Label>
            <Input id="settings-batch" inputMode="decimal" value={draft.batch} onChange={(e) => edit({ batch: e.target.value })} disabled={!editable} placeholder="Følger oppskriften" />
          </div>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || !draft.basis || !draft.base || conflict} onClick={() => void save()}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Lagre innstillinger
            </Button>
            {dirty && !conflict && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => { gen.current += 1; setDraft(hydrate(base)); setDirty(false); setNotice(null); }}>Angre endringer</Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { pendingPatch, pendingSelect, useCapability } from "@/lib/pendingRpc";
import { nNum } from "@/varer/lib/calcFormat";
import { DEFAULT_RESALE_FACTOR, parseFactor } from "@/varer/lib/handelsvarer";
import { RESALE_MARKUP_KEY } from "@/varer/hooks/useHandelsvarer";

interface Props { legalEntityId: string | null; canWrite: boolean }

type Stored = { packIn: boolean | null; factor: number | null };

/**
 * Emballasje i Brutto/DG2 og standard påslag på handelsvarer. Kolonnene kommer med PENDING
 * 20261118_prisgrunnlag og 20261118_handelsvarer; før de er kjørt vises bare standardvalget.
 */
export function MarginExtrasSettings({ legalEntityId, canWrite }: Props) {
  const capPack = useCapability("varer_cap_prisgrunnlag_v1");
  const capResale = useCapability("varer_cap_handelsvarer_v1");
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["varer", "calc-extras", legalEntityId, capPack, capResale] as const,
    enabled: !!legalEntityId && (capPack === true || capResale === true),
    queryFn: async (): Promise<Stored> => {
      const cols = [capPack === true ? "packaging_in_margins" : null, capResale === true ? "resale_default_factor" : null].filter(Boolean).join(",");
      const r = await pendingSelect("entity_calc_settings", `select=${cols}&legal_entity_id=eq.${encodeURIComponent(legalEntityId!)}`);
      if (r.kind !== "ok" || !Array.isArray(r.data)) throw new Error("Kunne ikke lese innstillingene.");
      const row = (r.data[0] ?? {}) as Record<string, unknown>;
      return {
        packIn: typeof row.packaging_in_margins === "boolean" ? row.packaging_in_margins : null,
        factor: row.resale_default_factor == null ? null : Number(row.resale_default_factor),
      };
    },
  });
  const [packIn, setPackIn] = useState(true);
  const [factor, setFactor] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setPackIn(q.data?.packIn ?? true);
    setFactor(q.data?.factor != null ? nNum(q.data.factor, 2) : "");
  }, [q.data]);

  async function save() {
    if (saving || !legalEntityId) return;
    const body: Record<string, unknown> = {};
    if (capPack === true) body.packaging_in_margins = packIn;
    if (capResale === true) {
      const f = factor.trim() === "" ? null : parseFactor(factor);
      if (factor.trim() !== "" && f == null) { toast.error("Skriv en faktor mellom 0,5 og 10, f.eks. 1,2"); return; }
      body.resale_default_factor = f;
    }
    setSaving(true);
    try {
      const r = await pendingPatch("entity_calc_settings", `legal_entity_id=eq.${encodeURIComponent(legalEntityId)}`, body);
      if (r.kind !== "ok") { toast.error(r.kind === "denied" ? "Du har ikke skrivetilgang." : "Innstillingen ble ikke lagret."); return; }
      if (!Array.isArray(r.data) || r.data.length !== 1) { toast.error("Lagre «Selskapets standard» først, så denne innstillingen."); return; }
      toast.success("Lagret");
      void qc.invalidateQueries({ queryKey: ["varer", "calc-extras", legalEntityId] });
      void qc.invalidateQueries({ queryKey: ["product-margins"] });
      void qc.invalidateQueries({ queryKey: ["profitability-sheet-matrix"] });
      void qc.invalidateQueries({ queryKey: RESALE_MARKUP_KEY(legalEntityId) });
    } finally {
      setSaving(false);
    }
  }

  const anyCap = capPack === true || capResale === true;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Emballasje og handelsvarer</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="pack-in-margins">Emballasje teller i Brutto og DG2</Label>
            <p className="text-xs text-muted-foreground">
              {capPack === true ? "Kakeeske, brødpose o.l. i kalkylen trekkes fra i begge marginene." : "Venter på databaseendringen «Prisgrunnlag». Til da holdes emballasje utenfor marginene i Lønnsomhet."}
            </p>
          </div>
          <Switch id="pack-in-margins" checked={capPack === true ? packIn : false} onCheckedChange={setPackIn} disabled={!canWrite || capPack !== true || q.isLoading} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="resale-default">Standard påslag på handelsvarer (faktor)</Label>
            <p className="text-xs text-muted-foreground">
              {capResale === true ? `Tomt = ${nNum(DEFAULT_RESALE_FACTOR, 1)}. Kan overstyres per prisgruppe og vare under Priser › Handelsvarer.` : `Venter på databaseendringen «Handelsvarer». Til da brukes ${nNum(DEFAULT_RESALE_FACTOR, 1)}.`}
            </p>
          </div>
          <Input id="resale-default" value={factor} onChange={(e) => setFactor(e.target.value)} placeholder={nNum(DEFAULT_RESALE_FACTOR, 2)}
            inputMode="decimal" className="h-9 w-24" disabled={!canWrite || capResale !== true || q.isLoading} />
        </div>
        {q.isError && <p role="alert" className="text-xs text-destructive">Kunne ikke lese innstillingene. Verdiene over er ukjente.</p>}
        {canWrite && anyCap && (
          <Button size="sm" onClick={save} disabled={saving || q.isLoading || q.isError}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Lagre
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppContext } from "@/varer/context/AppContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calculator, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { parseNum } from "@/varer/lib/calcFormat";
import {
  CALC_TYPE_LABEL,
  PRICE_LEVEL_LABEL,
  PRICE_LEVEL_ORDER,
  type CalcType,
  type PriceLevel,
} from "@/varer/hooks/useProductCalc";

const CALC_TYPES = Object.keys(CALC_TYPE_LABEL) as CalcType[];

export default function SettingsCalc() {
  const { legalEntityId, canWrite } = useAppContext();
  const qc = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["entity-calc-settings", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("entity_calc_settings")
        .select("*")
        .eq("legal_entity_id", legalEntityId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const categoriesQuery = useQuery({
    queryKey: ["main-categories-calc", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("product_main_categories")
        .select("id, display_name")
        .eq("legal_entity_id", legalEntityId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as { id: string; display_name: string }[];
    },
  });

  const targetsQuery = useQuery({
    queryKey: ["margin-targets", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("margin_targets")
        .select("*")
        .eq("legal_entity_id", legalEntityId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = settingsQuery.data;
    setForm({
      hourly_rate: s?.hourly_rate ?? 400,
      packaging_mode: s?.packaging_mode ?? "legges_til",
      markup_engros_pct: s?.markup_engros_pct ?? 20,
      markup_utsalg_pct: s?.markup_utsalg_pct ?? 23,
      default_vat_rate: s?.default_vat_rate ?? 15,
      default_dough_waste_pct: s?.default_dough_waste_pct ?? 0,
    });
  }, [settingsQuery.data]);

  async function saveSettings() {
    if (!legalEntityId) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("entity_calc_settings").upsert(
      {
        legal_entity_id: legalEntityId,
        hourly_rate: parseNum(form.hourly_rate),
        packaging_mode: form.packaging_mode,
        markup_engros_pct: parseNum(form.markup_engros_pct),
        markup_utsalg_pct: parseNum(form.markup_utsalg_pct),
        default_vat_rate: parseNum(form.default_vat_rate),
        default_dough_waste_pct: parseNum(form.default_dough_waste_pct),
        updated_at: new Date().toISOString(),
        updated_by: userData.user?.id ?? null,
      },
      { onConflict: "legal_entity_id" },
    );
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Innstillinger lagret");
    qc.invalidateQueries({ queryKey: ["entity-calc-settings", legalEntityId] });
  }

  async function addTarget() {
    if (!legalEntityId) return;
    const { error } = await (supabase as any).from("margin_targets").insert({
      legal_entity_id: legalEntityId,
      main_category_id: null,
      calc_type: null,
      price_level: "engros",
      target_brutto_pct: 65,
      target_dg2_pct: 40,
      warn_below_pp: 5,
    });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["margin-targets", legalEntityId] });
  }

  async function patchTarget(id: string, patch: Record<string, any>) {
    const { error } = await (supabase as any).from("margin_targets").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["margin-targets", legalEntityId] });
  }

  async function removeTarget(id: string) {
    const { error } = await (supabase as any).from("margin_targets").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["margin-targets", legalEntityId] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-app/10 text-app">
          <Calculator className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Kalkyle</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Standardverdier for kostpris- og marginberegning.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Selskapets standard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingsQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Timepris (kr/t)</Label>
                  <Input
                    value={form.hourly_rate ?? ""}
                    disabled={!canWrite}
                    onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))}
                    className="tabular-nums"
                  />
                </div>
                <div>
                  <Label className="text-xs">Emballasje</Label>
                  <RadioGroup
                    value={form.packaging_mode ?? "legges_til"}
                    onValueChange={(v) => setForm((f) => ({ ...f, packaging_mode: v }))}
                    disabled={!canWrite}
                    className="mt-2 space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="legges_til" id="pk-add" />
                      <Label htmlFor="pk-add" className="font-normal">Legges til prisen</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="trekkes_fra" id="pk-sub" />
                      <Label htmlFor="pk-sub" className="font-normal">Trekkes fra som kostnad</Label>
                    </div>
                  </RadioGroup>
                </div>
                <div>
                  <Label className="text-xs">Påslag engros (%)</Label>
                  <Input
                    value={form.markup_engros_pct ?? ""}
                    disabled={!canWrite}
                    onChange={(e) => setForm((f) => ({ ...f, markup_engros_pct: e.target.value }))}
                    className="tabular-nums"
                  />
                </div>
                <div>
                  <Label className="text-xs">Påslag utsalg (%)</Label>
                  <Input
                    value={form.markup_utsalg_pct ?? ""}
                    disabled={!canWrite}
                    onChange={(e) => setForm((f) => ({ ...f, markup_utsalg_pct: e.target.value }))}
                    className="tabular-nums"
                  />
                </div>
                <div>
                  <Label className="text-xs">Standard mva (%)</Label>
                  <Input
                    value={form.default_vat_rate ?? ""}
                    disabled={!canWrite}
                    onChange={(e) => setForm((f) => ({ ...f, default_vat_rate: e.target.value }))}
                    className="tabular-nums"
                  />
                </div>
                <div>
                  <Label className="text-xs">Standard deigsvinn (%)</Label>
                  <Input
                    value={form.default_dough_waste_pct ?? ""}
                    disabled={!canWrite}
                    onChange={(e) => setForm((f) => ({ ...f, default_dough_waste_pct: e.target.value }))}
                    className="tabular-nums"
                  />
                </div>
              </div>
              {canWrite && (
                <Button size="sm" onClick={saveSettings} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Lagre
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="text-base">Marginmål</CardTitle>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={addTarget}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Ny rad
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          {targetsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 text-left font-medium">Varegruppe</th>
                  <th className="py-2 text-left font-medium">Kalkyletype</th>
                  <th className="py-2 text-left font-medium">Prisnivå</th>
                  <th className="py-2 text-right font-medium">Mål brutto %</th>
                  <th className="py-2 text-right font-medium">Mål DG2 %</th>
                  <th className="py-2 text-right font-medium">Varsel under (pp)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(targetsQuery.data ?? []).map((t) => (
                  <tr key={t.id} className="border-b border-border/60">
                    <td className="py-1.5 pr-2">
                      <Select
                        value={t.main_category_id ?? "__all"}
                        disabled={!canWrite}
                        onValueChange={(v) => patchTarget(t.id, { main_category_id: v === "__all" ? null : v })}
                      >
                        <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all">Alle</SelectItem>
                          {(categoriesQuery.data ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <Select
                        value={t.calc_type ?? "__all"}
                        disabled={!canWrite}
                        onValueChange={(v) => patchTarget(t.id, { calc_type: v === "__all" ? null : v })}
                      >
                        <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all">Alle</SelectItem>
                          {CALC_TYPES.map((c) => (
                            <SelectItem key={c} value={c}>{CALC_TYPE_LABEL[c]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <Select
                        value={t.price_level}
                        disabled={!canWrite}
                        onValueChange={(v) => patchTarget(t.id, { price_level: v })}
                      >
                        <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PRICE_LEVEL_ORDER.map((p) => (
                            <SelectItem key={p} value={p}>{PRICE_LEVEL_LABEL[p as PriceLevel]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-1.5 pl-2">
                      <NumCell value={t.target_brutto_pct} disabled={!canWrite} onCommit={(v) => patchTarget(t.id, { target_brutto_pct: v })} />
                    </td>
                    <td className="py-1.5 pl-2">
                      <NumCell value={t.target_dg2_pct} disabled={!canWrite} onCommit={(v) => patchTarget(t.id, { target_dg2_pct: v })} />
                    </td>
                    <td className="py-1.5 pl-2">
                      <NumCell value={t.warn_below_pp} disabled={!canWrite} onCommit={(v) => patchTarget(t.id, { warn_below_pp: v })} />
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      {canWrite && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeTarget(t.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {(targetsQuery.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground">
                      Ingen marginmål satt opp.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted-foreground">Målet på varen selv overstyrer alt her.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function NumCell({
  value,
  disabled,
  onCommit,
}: {
  value: number | null;
  disabled?: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [local, setLocal] = useState(value == null ? "" : String(value));
  useEffect(() => setLocal(value == null ? "" : String(value)), [value]);
  return (
    <Input
      value={local}
      disabled={disabled}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const n = parseNum(local);
        if (n !== value) onCommit(n);
      }}
      className="h-9 w-28 text-right tabular-nums"
    />
  );
}

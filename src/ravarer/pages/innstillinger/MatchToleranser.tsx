import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { showError } from "@/lib/userError";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useMatchTolerances, FALLBACK_TOLERANCE_PCT } from "@/fakturaer/hooks/useMatchTolerances";
import { QueryState } from "@/components/common/QueryState";

interface ToleranceRow {
  id: string;
  legal_entity_id: string;
  category: string;
  price_tolerance_pct: number;
}

const SETTINGS_KEY = "invoice-match-tolerances";

export default function MatchToleranserPage() {
  const { legalEntityId, canWrite } = useRavarer();
  const qc = useQueryClient();
  const [newCat, setNewCat] = useState("");
  const [newPct, setNewPct] = useState("5");
  const [deleteRow, setDeleteRow] = useState<ToleranceRow | null>(null);

  const tolerances = useMatchTolerances(legalEntityId);

  const rowsQuery = useQuery({
    queryKey: ["match-tolerances", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_match_category_tolerances")
        .select("id, legal_entity_id, category, price_tolerance_pct")
        .eq("legal_entity_id", legalEntityId)
        .order("category");
      if (error) throw error;
      return (data ?? []) as ToleranceRow[];
    },
  });
  const rows = rowsQuery.data ?? [];

  /** Kategoriene som finnes på råvarene — grunnlag for kategorivelgeren. */
  const categoriesQuery = useQuery({
    queryKey: ["raw-material-categories", legalEntityId],
    enabled: !!legalEntityId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("category")
        .eq("legal_entity_id", legalEntityId)
        .not("category", "is", null)
        .limit(2000);
      if (error) throw error;
      const set = new Set<string>();
      (data ?? []).forEach((r) => {
        if (r.category) set.add(r.category);
      });
      return [...set].sort((a, b) => a.localeCompare(b, "nb"));
    },
  });
  const availableCategories = (categoriesQuery.data ?? []).filter((c) => !rows.some((r) => r.category === c));

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["match-tolerances"] });
    void qc.invalidateQueries({ queryKey: [SETTINGS_KEY] });
  };

  const saveSettings = useMutation({
    mutationFn: async (patch: Record<string, number | boolean | null>) => {
      const { error } = await supabase
        .from("invoice_match_settings")
        .upsert({ legal_entity_id: legalEntityId, ...patch }, { onConflict: "legal_entity_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Innstillinger lagret");
    },
    onError: (e) => showError("match-innstillinger", e, "Kunne ikke lagre innstillingene"),
  });

  const upsert = useMutation({
    mutationFn: async (input: { id?: string; category: string; price_tolerance_pct: number }) => {
      if (input.id) {
        const { error } = await supabase
          .from("invoice_match_category_tolerances")
          .update({ price_tolerance_pct: input.price_tolerance_pct })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("invoice_match_category_tolerances").insert({
          legal_entity_id: legalEntityId,
          category: input.category,
          price_tolerance_pct: input.price_tolerance_pct,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success("Lagret");
      setNewCat("");
      setNewPct("5");
    },
    onError: (e) => showError("match-toleranse", e, "Kunne ikke lagre toleransen"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoice_match_category_tolerances").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setDeleteRow(null);
      toast.success("Kategorien er fjernet");
    },
    onError: (e) => showError("match-toleranse-slett", e, "Kunne ikke slette kategorien"),
  });

  const s = tolerances.settings;

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner
        title="Match-toleranser"
        subtitle="Én kilde for prisavvik og automatisk matching av fakturalinjer"
      />

      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-title text-sm font-semibold">Global toleranse og automatikk</h2>
          <p className="text-caption text-ink-secondary">
            Gjelder alle råvarer uten egen kategoritoleranse. Brukes både i behandlingskøen og i fargelegging av avvik.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <NumField
            label="Prisavvik-toleranse (%)"
            hint="Avvik under denne grensen regnes som normalt og krever ikke gjennomgang."
            value={s?.default_price_tolerance_pct ?? tolerances.defaultPct ?? FALLBACK_TOLERANCE_PCT}
            disabled={!canWrite || tolerances.isLoading}
            onCommit={(v) => saveSettings.mutate({ default_price_tolerance_pct: v })}
          />
          <NumField
            label="Fuzzy-terskel for forslag"
            hint="Hvor likt navnet må være (0–1) før linjen får et matchforslag."
            step={0.05}
            value={s?.fuzzy_match_threshold ?? 0.5}
            disabled={!canWrite || tolerances.isLoading}
            onCommit={(v) => saveSettings.mutate({ fuzzy_match_threshold: v })}
          />
          <NumField
            label="Fuzzy-terskel for automatch"
            hint="Over denne likheten (0–1) matches linjen automatisk uten gjennomgang."
            step={0.05}
            value={s?.fuzzy_auto_match_threshold ?? 0.85}
            disabled={!canWrite || tolerances.isLoading}
            onCommit={(v) => saveSettings.mutate({ fuzzy_auto_match_threshold: v })}
          />
          <NumField
            label="Krav om klar vinner (0–1)"
            hint="Beste forslag må være så mye bedre enn nest beste før automatch tillates."
            step={0.05}
            value={s?.fuzzy_auto_match_dominance_threshold ?? 0.1}
            disabled={!canWrite || tolerances.isLoading}
            onCommit={(v) => saveSettings.mutate({ fuzzy_auto_match_dominance_threshold: v })}
          />
        </div>

        <div className="space-y-3 border-t border-line-subtle pt-3">
          <ToggleRow
            label="Godkjenn automatisk innenfor toleranse"
            hint="Linjer med prisavvik under toleransen markeres ikke for gjennomgang."
            checked={!!s?.auto_approve_within_tolerance}
            disabled={!canWrite || tolerances.isLoading}
            onChange={(v) => saveSettings.mutate({ auto_approve_within_tolerance: v })}
          />
          <ToggleRow
            label="Avstem rene importer automatisk"
            hint="Fakturaer der alle linjer matcher og summene stemmer avstemmes uten manuelt trykk."
            checked={!!s?.auto_reconcile_clean_imports}
            disabled={!canWrite || tolerances.isLoading}
            onChange={(v) => saveSettings.mutate({ auto_reconcile_clean_imports: v })}
          />
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <h2 className="text-title text-sm font-semibold">Toleranse per kategori</h2>
          <p className="text-caption text-ink-secondary">Overstyrer den globale toleransen for valgt kategori.</p>
        </div>

        <QueryState
          scope="Kategoritoleranser"
          isLoading={rowsQuery.isLoading}
          isError={rowsQuery.isError}
          error={rowsQuery.error}
          onRetry={() => void rowsQuery.refetch()}
          isEmpty={false}
        >
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink-secondary">
              <tr>
                <th className="py-2">Kategori</th>
                <th className="w-40 py-2">Toleranse %</th>
                <th className="w-12 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line-subtle">
                  <td className="py-2">{r.category}</td>
                  <td className="py-2">
                    <Input
                      type="number"
                      step="0.1"
                      defaultValue={r.price_tolerance_pct}
                      disabled={!canWrite}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v !== r.price_tolerance_pct)
                          upsert.mutate({ id: r.id, category: r.category, price_tolerance_pct: v });
                      }}
                      className="h-8"
                    />
                  </td>
                  <td className="py-2">
                    {canWrite && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Slett toleranse for ${r.category}`}
                        onClick={() => setDeleteRow(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr className="border-t border-line-subtle">
                  <td colSpan={3} className="py-3 text-ink-secondary">
                    Ingen kategorier har egen toleranse ennå.
                  </td>
                </tr>
              )}
              {canWrite && (
                <tr className="border-t border-line-subtle">
                  <td className="py-2">
                    <Select value={newCat} onValueChange={setNewCat}>
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Velg kategori" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCategories.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-2">
                    <Input
                      value={newPct}
                      onChange={(e) => setNewPct(e.target.value)}
                      type="number"
                      step="0.1"
                      className="h-8"
                    />
                  </td>
                  <td className="py-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Legg til kategoritoleranse"
                      disabled={!newCat.trim() || upsert.isPending}
                      onClick={() =>
                        upsert.mutate({ category: newCat.trim(), price_tolerance_pct: parseFloat(newPct) || 0 })
                      }
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </QueryState>
      </Card>

      <AlertDialog open={!!deleteRow} onOpenChange={(v) => { if (!v) setDeleteRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette toleransen for «{deleteRow?.category}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Kategorien faller tilbake på den globale toleransen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteRow && del.mutate(deleteRow.id)}>
              {del.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NumField({
  label,
  hint,
  value,
  step = 0.1,
  disabled,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  step?: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step={step}
        defaultValue={value}
        key={value}
        disabled={disabled}
        className="h-9"
        onBlur={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v !== value) onCommit(v);
        }}
      />
      <p className="text-caption text-ink-secondary">{hint}</p>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-caption text-ink-secondary">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

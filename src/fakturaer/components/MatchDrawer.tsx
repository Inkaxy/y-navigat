import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";
import { formatNok, formatDate } from "@/fakturaer/lib/constants";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  line: ReviewLineRow | null;
}

interface RmRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  current_cost_price: number | null;
  base_unit: string | null;
  primary_supplier_id: string | null;
}

export function MatchDrawer({ open, onOpenChange, line }: Props) {
  const qc = useQueryClient();
  const [selectedRmId, setSelectedRmId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [rememberSku, setRememberSku] = useState(true);
  const [rememberName, setRememberName] = useState(true);
  const [setAsPrimary, setSetAsPrimary] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedRmId(null);
    setSearch("");
    setRememberSku(!!line?.supplier_sku);
    setRememberName(!!line?.description && line?.description !== line?.supplier_sku);
    setSetAsPrimary(false);
  }, [open, line?.id]);

  const legalEntityId = line?.invoice.legal_entity_id;
  const supplierId = line?.invoice.supplier_id;

  const { data: rmResults = [], isLoading: searching } = useQuery({
    queryKey: ["rm-search", legalEntityId, search],
    enabled: !!legalEntityId && search.length > 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("id, name, sku, category, current_cost_price, base_unit, primary_supplier_id")
        .eq("legal_entity_id", legalEntityId!)
        .eq("is_active", true)
        .or(`name.ilike.%${search}%,sku.ilike.%${search}%`)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as RmRow[];
    },
  });

  const { data: selectedRm } = useQuery({
    queryKey: ["rm-detail", selectedRmId],
    enabled: !!selectedRmId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("id, name, sku, category, current_cost_price, base_unit, primary_supplier_id")
        .eq("id", selectedRmId!)
        .single();
      if (error) throw error;
      return data as RmRow;
    },
  });

  const { data: existingRms } = useQuery({
    queryKey: ["rms-link", selectedRmId, supplierId],
    enabled: !!selectedRmId && !!supplierId,
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_material_suppliers")
        .select("id, supplier_id, agreed_price_per_base_unit, is_primary")
        .eq("raw_material_id", selectedRmId!);
      return data ?? [];
    },
  });

  const linkExists = useMemo(() => existingRms?.find((r: any) => r.supplier_id === supplierId), [existingRms, supplierId]);
  const anyPrimary = useMemo(() => existingRms?.some((r: any) => r.is_primary), [existingRms]);

  const suggestions = line?.suggestions ?? [];

  async function performMatch(applyToAll: boolean) {
    if (!line || !selectedRmId) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Ikke innlogget");

      // 1) Ensure raw_material_suppliers link
      let rmsRow = linkExists as any;
      if (!rmsRow) {
        const { data: ins, error } = await supabase.from("raw_material_suppliers").insert({
          raw_material_id: selectedRmId,
          supplier_id: supplierId!,
          supplier_sku: line.supplier_sku,
          supplier_product_name: line.description,
          is_primary: setAsPrimary && !anyPrimary ? true : false,
        }).select().single();
        if (error) throw error;
        rmsRow = ins;
      }

      if (setAsPrimary && !anyPrimary) {
        await supabase.from("raw_material_suppliers")
          .update({ is_primary: false })
          .eq("raw_material_id", selectedRmId)
          .neq("id", rmsRow.id);
        await supabase.from("raw_material_suppliers").update({ is_primary: true }).eq("id", rmsRow.id);
        await supabase.from("raw_materials").update({ primary_supplier_id: supplierId }).eq("id", selectedRmId);
      }

      // 2) Aliases
      const nowIso = new Date().toISOString();
      const aliasInserts: any[] = [];
      if (rememberSku && line.supplier_sku) aliasInserts.push({
        raw_material_supplier_id: rmsRow.id, alias_type: "supplier_sku",
        alias_value: line.supplier_sku, status: "confirmed",
        confirmed_by: user.id, confirmed_at: nowIso, first_seen_invoice_id: line.invoice_id,
      });
      if (rememberName && line.description) aliasInserts.push({
        raw_material_supplier_id: rmsRow.id, alias_type: "product_name",
        alias_value: line.description, status: "confirmed",
        confirmed_by: user.id, confirmed_at: nowIso, first_seen_invoice_id: line.invoice_id,
      });
      for (const a of aliasInserts) {
        await supabase.from("raw_material_supplier_aliases").upsert(a, {
          onConflict: "alias_type,alias_value_normalized,raw_material_supplier_id",
        });
      }

      // 3) Set match on this line (or all matching lines in invoice)
      const lineIds: string[] = [line.id];
      if (applyToAll) {
        const { data: sib } = await supabase.from("invoice_lines")
          .select("id, supplier_sku, description")
          .eq("invoice_id", line.invoice_id);
        (sib ?? []).forEach((s: any) => {
          if (s.id === line.id) return;
          if ((line.supplier_sku && s.supplier_sku === line.supplier_sku) ||
              (line.description && s.description === line.description)) lineIds.push(s.id);
        });
      }
      await supabase.from("invoice_lines")
        .update({ raw_material_id: selectedRmId, match_confidence: "manual", requires_review: false, review_reason: null,
                  resolved_by: user.id, resolved_at: nowIso })
        .in("id", lineIds);

      // 4) Re-run pipeline for these lines (reapplies price variance check)
      await supabase.functions.invoke("match-invoice-lines", { body: { invoice_id: line.invoice_id, line_ids: lineIds } });

      toast.success(applyToAll ? `Matchet ${lineIds.length} linjer` : "Linje matchet");
      qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] });
      qc.invalidateQueries({ queryKey: ["fakturaer-review-count"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke matche");
    } finally {
      setBusy(false);
    }
  }

  if (!line) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-[60vw] sm:max-w-[60vw] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Match fakturalinje</SheetTitle>
        </SheetHeader>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
          {/* Left – context */}
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-lg font-semibold">{line.invoice.supplier?.name}</div>
              <div className="text-ink-secondary">Faktura {line.invoice.invoice_number} • {formatDate(line.invoice.invoice_date)}</div>
            </div>
            <dl className="space-y-2 rounded-lg border border-line-subtle bg-muted/20 p-4">
              <KV k="SKU" v={line.supplier_sku ?? "—"} mono />
              <KV k="Beskrivelse" v={line.description ?? "—"} />
              <KV k="Mengde" v={`${line.quantity ?? "—"} ${line.unit ?? ""}`} />
              <KV k="Pris/enhet" v={formatNok(line.unit_price)} />
              <KV k="Sum" v={formatNok(line.total_amount)} />
            </dl>
            {line.invoice.source_document_url && (
              <a href={line.invoice.source_document_url} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> Originaldokument
              </a>
            )}
          </div>

          {/* Right – matching */}
          <div className="space-y-5">
            {suggestions.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">Foreslåtte matcher</h4>
                <RadioGroup value={selectedRmId ?? ""} onValueChange={(v) => setSelectedRmId(v)} className="space-y-2">
                  {suggestions.map((s) => (
                    <label key={s.raw_material_id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-subtle p-3 hover:bg-muted/30">
                      <RadioGroupItem value={s.raw_material_id} className="mt-1" />
                      <div className="flex-1">
                        <div className="font-medium">{s.raw_material?.name ?? "Ukjent"}</div>
                        <div className="text-xs text-ink-secondary">
                          {s.raw_material?.category ?? "—"} • Kostpris {formatNok(s.raw_material?.current_cost_price)}
                        </div>
                        <div className="mt-1 text-xs text-ink-secondary">
                          {s.match_reason} • {Math.round(s.confidence * 100)}%
                        </div>
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              </div>
            )}

            <div>
              <Label className="mb-1.5 block">Søk etter råvare</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Navn eller SKU…" className="pl-9" />
              </div>
              {searching && <Loader2 className="mx-auto my-3 h-4 w-4 animate-spin text-ink-secondary" />}
              {rmResults.length > 0 && (
                <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-line-subtle">
                  {rmResults.map((r) => (
                    <button key={r.id} type="button"
                      onClick={() => { setSelectedRmId(r.id); setSearch(r.name); }}
                      className="flex w-full items-center justify-between gap-3 border-b border-line-subtle p-2.5 text-left text-sm last:border-0 hover:bg-muted/40">
                      <div>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-ink-secondary">{r.sku ?? "—"} • {r.category ?? "—"}</div>
                      </div>
                      <div className="text-xs tabular-nums text-ink-secondary">{formatNok(r.current_cost_price)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedRm && (
              <div className="rounded-lg border border-line-subtle p-4">
                <div className="font-medium">{selectedRm.name}</div>
                <div className="text-xs text-ink-secondary">{selectedRm.category ?? "—"} • {selectedRm.sku ?? "—"}</div>
                <div className="mt-3 text-sm">
                  {linkExists ? (
                    <div className="text-success">✅ Denne leverandøren er allerede knyttet til råvaren</div>
                  ) : (
                    <div className="text-warning">⚠️ Ny leverandørkobling vil opprettes</div>
                  )}
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <label className="flex items-start gap-2">
                    <Checkbox checked={rememberSku} onCheckedChange={(v) => setRememberSku(!!v)} disabled={!line.supplier_sku} />
                    <span>Husk SKU <code className="rounded bg-muted px-1">{line.supplier_sku ?? "—"}</code> for denne leverandøren</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Checkbox checked={rememberName} onCheckedChange={(v) => setRememberName(!!v)} disabled={!line.description} />
                    <span>Husk produktnavn «{line.description}» for denne leverandøren</span>
                  </label>
                  {!anyPrimary && (
                    <label className="flex items-start gap-2">
                      <Checkbox checked={setAsPrimary} onCheckedChange={(v) => setSetAsPrimary(!!v)} />
                      <span>Sett denne leverandøren som primær for råvaren</span>
                    </label>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button onClick={() => performMatch(false)} disabled={!selectedRmId || busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Bekreft match
              </Button>
              <Button variant="outline" onClick={() => performMatch(true)} disabled={!selectedRmId || busy}>
                Bekreft og bruk på alle like linjer
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Avbryt</Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-secondary">{k}</dt>
      <dd className={mono ? "font-mono text-xs" : "font-medium"}>{v}</dd>
    </div>
  );
}

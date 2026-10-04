import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/common/QueryState";
import { DecisionNav } from "@/fakturaer/components/decisions/DecisionNav";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { fetchAllRows } from "@/lib/supabasePaging";
import { formatMoney } from "@/fakturaer/lib/constants";
import { rematchLines } from "@/fakturaer/lib/queueActions";
import { AuditHistory } from "@/fakturaer/components/decisions/AuditHistory";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";

interface LinkRow {
  id: string;
  supplier_sku: string | null;
  supplier_product_name: string | null;
  package_size: number | null;
  package_unit: string | null;
  base_units_per_package: number | null;
  package_confirmed_at: string | null;
  last_invoice_price: number | null;
  last_invoice_date: string | null;
  raw_material_id: string;
  raw_material: { name: string; base_unit: string | null } | null;
  aliases: Array<{ alias_type: string; alias_value: string; status: string }>;
}

interface OpenLine { id: string; invoice_id: string; raw_material_id: string | null; invoice: { id: string; invoice_number: string; supplier_id: string; status: string | null } }
interface Variant { raw_material_supplier_id: string; supplier_sku_norm: string; package_size: number | null; package_unit: string | null; base_units_per_package: number; confirmed_at: string }

const LINK_ERR: Record<string, string> = {
  forbidden: "Mangler skrivetilgang",
  kobling_finnes: "Leverandøren har allerede en kobling til den råvaren",
  ugyldig_raavare: "Råvaren er inaktiv eller i et annet selskap",
  samme_raavare: "Velg en annen råvare",
  begrunnelse_mangler: "Skriv en begrunnelse",
};

const dt = (s: string | null) => (s ? new Date(s).toLocaleDateString("nb-NO", { dateStyle: "medium" }) : "–");

function ChangeLink({ row, supplierId, onDone }: { row: LinkRow; supplierId: string; onDone: () => void }) {
  const { data: company } = useCompany();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const materials = useQuery({
    queryKey: ["vareminne-materials", company?.id, search],
    enabled: !!company?.id && search.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.from("raw_materials").select("id, name, base_unit").eq("legal_entity_id", company!.id).eq("is_active", true).ilike("name", `%${search.trim()}%`).order("name").limit(20);
      if (error) throw new Error("Kunne ikke søke i råvarene");
      return data ?? [];
    },
  });
  // Bare ÅPNE linjer uten ført kostpris kan flyttes. Serveren kontrollerer det samme ved lagring.
  const affected = useQuery({
    queryKey: ["vareminne-affected", supplierId, row.id, row.supplier_sku],
    enabled: !!row.supplier_sku,
    queryFn: async () => {
      const all = await fetchAllRows<OpenLine>((from, to) =>
        supabase.from("invoice_lines")
          .select("id, invoice_id, raw_material_id, invoice:invoices!inner(id, invoice_number, supplier_id, status)")
          .eq("supplier_sku", row.supplier_sku!)
          .eq("raw_material_id", row.raw_material_id)
          .eq("invoice.supplier_id", supplierId)
          .not("invoice.status", "in", "(reconciled,cancelled)")
          .order("id")
          .range(from, to) as unknown as PromiseLike<{ data: OpenLine[] | null; error: { message: string } | null }>);
      const ids = all.map((l) => l.id);
      const posted = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from("invoice_line_cost_postings").select("invoice_line_id").in("invoice_line_id", ids.slice(i, i + 200)).is("revoked_at", null);
        if (error) throw new Error("Kunne ikke kontrollere førte linjer");
        (data ?? []).forEach((p) => posted.add(p.invoice_line_id));
      }
      return { open: all.filter((l) => !posted.has(l.id)), locked: posted.size };
    },
  });
  const open = affected.data?.open ?? [];
  async function apply() {
    setBusy(true);
    try {
      const frozen = open; // listen brukeren så
      const { data, error } = await supabase.rpc("rm_change_supplier_link", {
        p_rms_id: row.id, p_new_raw_material_id: target, p_reason: reason.trim(), p_line_ids: frozen.map((l) => l.id),
      });
      if (error) throw new Error(LINK_ERR[Object.keys(LINK_ERR).find((k) => error.message.includes(k)) ?? ""] ?? "Kunne ikke endre koblingen");
      const res = (data ?? {}) as { changed_line_ids?: string[]; locked_lines?: number };
      const changed = new Set(res.changed_line_ids ?? []);
      const failures = changed.size ? await rematchLines(frozen.filter((l) => changed.has(l.id))) : [];
      const pending = failures.reduce((s, f) => s + f.lineIds.length, 0);
      const skipped = frozen.length - changed.size;
      const parts = [`Koblingen er endret for fremtidige importer.`, `${changed.size} åpne linjer flyttet.`];
      if (skipped) parts.push(`${skipped} linjer var endret eller låst og ble ikke flyttet.`);
      if (pending) parts.push(`Lagret, men beregningen gjenstår for ${pending} linjer.`);
      (pending || skipped ? toast.warning : toast.success)(parts.join(" "));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke endre koblingen");
    } finally {
      setBusy(false);
    }
  }
  const invoices = new Set(open.map((l) => l.invoice_id)).size;
  return (
    <div className="space-y-2 rounded-lg bg-muted/30 p-3">
      <Label htmlFor={`s-${row.id}`}>Ny råvare</Label>
      <Input id={`s-${row.id}`} placeholder="Søk minst to bokstaver" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="flex flex-wrap gap-1">
        {(materials.data ?? []).filter((m) => m.id !== row.raw_material_id).map((m) => (
          <Button key={m.id} size="sm" variant={target === m.id ? "default" : "outline"} onClick={() => setTarget(m.id)}>{m.name}{m.base_unit ? ` (${m.base_unit})` : ""}</Button>
        ))}
      </div>
      <Label htmlFor={`r-${row.id}`}>Begrunnelse</Label>
      <Input id={`r-${row.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="text-sm">
        {!row.supplier_sku ? "Koblingen mangler varenummer: bare fremtidige importer påvirkes."
          : affected.isLoading ? "Teller berørte linjer …"
          : affected.isError ? "Kunne ikke telle berørte linjer."
          : `Flytter ${open.length} åpne linjer på ${invoices} fakturaer.${affected.data?.locked ? ` ${affected.data.locked} linjer med ført kostpris endres ikke.` : ""} Avstemte fakturaer og prishistorikk endres ikke. Fremtidige importer bruker ny råvare.`}
      </p>
      <Button size="sm" disabled={!target || !reason.trim() || busy || (!!row.supplier_sku && (affected.isLoading || affected.isError))} onClick={apply}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{open.length ? `Endre kobling og flytt ${open.length} linjer` : "Endre kobling for fremtidige importer"}
      </Button>
    </div>
  );
}

export default function Vareminne() {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const [supplierId, setSupplierId] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const { canWrite } = useInvoiceRights();
  const suppliers = useQuery({
    queryKey: ["vareminne-suppliers", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").eq("legal_entity_id", company!.id).order("name").limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const links = useQuery({
    queryKey: ["vareminne-links", supplierId],
    enabled: !!supplierId,
    queryFn: () =>
      fetchAllRows<LinkRow>((from, to) =>
        supabase.from("raw_material_suppliers")
          .select("id, supplier_sku, supplier_product_name, package_size, package_unit, base_units_per_package, package_confirmed_at, last_invoice_price, last_invoice_date, raw_material_id, raw_material:raw_materials(name, base_unit), aliases:raw_material_supplier_aliases(alias_type, alias_value, status)")
          .eq("supplier_id", supplierId)
          .order("id")
          .range(from, to) as unknown as PromiseLike<{ data: LinkRow[] | null; error: { message: string } | null }>),
  });
  const variants = useQuery({
    queryKey: ["vareminne-variants", supplierId, (links.data ?? []).length],
    enabled: !!links.data?.length,
    queryFn: async () => {
      const ids = (links.data ?? []).map((l) => l.id);
      const out: Variant[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from("raw_material_supplier_packages").select("raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at").in("raw_material_supplier_id", ids.slice(i, i + 200)).order("confirmed_at", { ascending: false });
        if (error) throw new Error("Kunne ikke hente pakningsvarianter");
        out.push(...((data ?? []) as Variant[]));
      }
      return out;
    },
  });
  const f = filter.trim().toLowerCase();
  const rows = useMemo(() => (links.data ?? []).filter((r) => !f || [r.supplier_sku, r.supplier_product_name, r.raw_material?.name].some((v) => (v ?? "").toLowerCase().includes(f))), [links.data, f]);

  return (
    <div className="px-page py-6 space-y-5">
      <DecisionNav />
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Lagrede koblinger</h1>
        <p className="text-ink-secondary">Leverandørens varenummer → råvare → bekreftede pakninger. Brukes automatisk ved neste import.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Leverandør" className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Velg leverandør</option>
          {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Input aria-label="Filtrer" placeholder="Filtrer på varenummer eller råvare" className="max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {supplierId && (
        <QueryState isLoading={links.isLoading} isError={links.isError} error={links.error} scope="fakturaer:vareminne" onRetry={() => links.refetch()} isEmpty={rows.length === 0} emptyTitle="Ingen lagrede koblinger">
          <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle bg-card">
            {rows.map((r) => {
              const unit = r.raw_material?.base_unit ?? "grunnenhet";
              const confirmedAliases = r.aliases.filter((a) => a.status === "confirmed");
              return (
                <li key={r.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{r.supplier_sku ? `Nr. ${r.supplier_sku}` : "Uten varenummer"} → {r.raw_material?.name ?? "Ukjent råvare"}</p>
                      <p className="text-sm text-ink-secondary">{r.supplier_product_name ?? ""}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" aria-expanded={history === r.id} onClick={() => setHistory(history === r.id ? null : r.id)}>Historikk</Button>
                      {canWrite && <Button size="sm" variant="outline" onClick={() => setEditing(editing === r.id ? null : r.id)}>{editing === r.id ? "Lukk" : "Endre kobling"}</Button>}
                    </div>
                  </div>
                  <p className="text-sm">
                    Pakning: {r.base_units_per_package ? `${r.base_units_per_package} ${unit} per pakning` : "ikke angitt"}
                    {r.package_size ? ` (${r.package_size} ${r.package_unit ?? ""})` : ""} ·{" "}
                    {r.package_confirmed_at ? <span className="text-success">bekreftet {dt(r.package_confirmed_at)}</span> : <span className="text-warning">ikke bekreftet</span>}
                  </p>
                  {(() => {
                    const vs = (variants.data ?? []).filter((v) => v.raw_material_supplier_id === r.id);
                    return vs.length > 0 ? (
                      <p className="text-sm">Bekreftede pakningsvarianter: {vs.map((v) => `${v.base_units_per_package} ${unit}${v.package_size ? ` (${v.package_size} ${v.package_unit ?? ""})` : ""}, ${dt(v.confirmed_at)}`).join(" · ")}</p>
                    ) : null;
                  })()}
                  <p className="text-sm text-ink-secondary">
                    Sist fakturert {dt(r.last_invoice_date)}{r.last_invoice_price != null ? ` til ${formatMoney(r.last_invoice_price, "NOK")}` : ""} · kilde: {confirmedAliases.length ? `bekreftet alias (${confirmedAliases.map((a) => a.alias_value).join(", ")})` : "koblet fra faktura"}
                  </p>
                  {history === r.id && <div className="rounded-lg bg-muted/30 p-3"><AuditHistory entityId={r.id} kind="supplier_link" /></div>}
                  {editing === r.id && <ChangeLink row={r} supplierId={supplierId} onDone={() => { setEditing(null); ["vareminne-links", "vareminne-variants", "vareminne-affected", "fakturaer-review-lines", "fakturaer-inbox", "invoice-approval-overview", "audit-history"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }} />}
                </li>
              );
            })}
          </ul>
        </QueryState>
      )}
    </div>
  );
}

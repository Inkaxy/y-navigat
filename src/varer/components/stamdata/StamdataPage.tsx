import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import { logAudit, type AuditEntityType } from "@/varer/lib/audit";
import { useAppContext } from "@/varer/context/AppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

/* ---------- Typer ---------- */

export type StamdataRow = {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  sort_order: number;
  status: string;
  legal_entity_id: string;
  // Ekstra felt (f.eks. main_category_id)
  [k: string]: unknown;
};

export type ExtraSelectField = {
  /** felt-navn i tabellen */
  key: string;
  label: string;
  /** lookup-tabell for valg */
  lookupTable: string;
  /** valgfritt: kun rader med status='active' */
  activeOnly?: boolean;
  required?: boolean;
};

export type ExtraColumn = {
  header: string;
  /** Funksjon for å rendre kolonneverdi gitt en rad og lookup-data. */
  render: (row: StamdataRow, lookups: Record<string, StamdataRow[]>) => React.ReactNode;
};

export type StamdataUsageCheck = {
  /** Tabell som refererer til denne stamdata-raden. */
  table: string;
  /** Kolonnen i `table` som inneholder stamdata-id. */
  column: string;
};

export type ExtraProductPicker = {
  /** Felt-navn på stamdata-tabellen, f.eks. "main_product_id". */
  key: string;
  label: string;
  /** Kolonne på products som må matche stamdata-radens id, f.eks. "production_group_id". */
  productFilterColumn: string;
  /** Kun aktive produkter (status='active'). Default true. */
  activeOnly?: boolean;
};

export type StamdataPageProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Supabase-tabellnavn for stamdata-en. */
  tableName: string;
  /** Audit-entitetstype for logging. */
  auditEntityType: AuditEntityType;
  /** Junction-tabeller som peker til denne stamdata-raden — brukes for "i bruk"-sjekk og delete-blokkering. */
  usageChecks: StamdataUsageCheck[];
  /** Ekstra select-felt (f.eks. main_category_id for undervaregrupper). */
  extraFields?: ExtraSelectField[];
  /** Ekstra kolonner i tabellen (f.eks. visning av main_category_navn). */
  extraColumns?: ExtraColumn[];
  /** Valgfri picker for å koble til et produkt (f.eks. hovedvare). Kun synlig ved redigering. */
  extraProductPicker?: ExtraProductPicker;
};

/* ---------- Hjelpere ---------- */

const codeRegex = /^[a-z0-9_]+$/;

function emptyForm(extraFields: ExtraSelectField[] = []) {
  const extras: Record<string, string> = {};
  for (const f of extraFields) extras[f.key] = "";
  return {
    code: "",
    display_name: "",
    description: "",
    sort_order: "99",
    status: "active",
    ...extras,
  };
}

/* ---------- Komponent ---------- */

export function StamdataPage({
  title,
  description,
  icon: Icon,
  tableName,
  auditEntityType,
  usageChecks,
  extraFields = [],
  extraColumns = [],
  extraProductPicker,
}: StamdataPageProps) {
  const qc = useQueryClient();
  const { canWrite, legalEntityId } = useAppContext();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StamdataRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StamdataRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [form, setForm] = useState(() => emptyForm(extraFields));
  const [pickerValue, setPickerValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

  /* ----- Hovedliste ----- */
  const listQuery = useQuery({
    queryKey: ["stamdata", tableName, legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(tableName as never)
        .select("*")
        .eq("legal_entity_id", legalEntityId)
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return (data ?? []) as unknown as StamdataRow[];
    },
  });

  /* ----- Bruks-tellinger (én query per usageCheck-tabell) ----- */
  const usageQuery = useQuery({
    queryKey: ["stamdata-usage", tableName, legalEntityId],
    enabled: !!listQuery.data,
    queryFn: async () => {
      const counts: Record<string, number> = {};
      const ids = (listQuery.data ?? []).map((r) => r.id);
      if (ids.length === 0) return counts;
      for (const check of usageChecks) {
        const { data, error } = await supabase
          .from(check.table as never)
          .select(`${check.column}`)
          .in(check.column, ids);
        if (error) {
          console.warn("usage check failed", check, error);
          continue;
        }
        for (const row of (data ?? []) as Array<Record<string, string>>) {
          const id = row[check.column];
          if (!id) continue;
          counts[id] = (counts[id] ?? 0) + 1;
        }
      }
      return counts;
    },
  });

  /* ----- Lookups for ekstra select-felt ----- */
  const lookupTables = useMemo(
    () => Array.from(new Set(extraFields.map((f) => f.lookupTable))),
    [extraFields],
  );

  const lookupQueries = useQuery({
    queryKey: ["stamdata-lookups", lookupTables, legalEntityId],
    enabled: lookupTables.length > 0,
    queryFn: async () => {
      const results: Record<string, StamdataRow[]> = {};
      for (const t of lookupTables) {
        const { data, error } = await supabase
          .from(t as never)
          .select("*")
          .eq("legal_entity_id", legalEntityId)
          .order("sort_order")
          .order("display_name");
        if (error) {
          console.warn("lookup failed", t, error);
          results[t] = [];
        } else {
          results[t] = (data ?? []) as unknown as StamdataRow[];
        }
      }
      return results;
    },
  });

  /* ----- Filtrert liste ----- */
  const filtered = useMemo(() => {
    const rows = listQuery.data ?? [];
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.display_name.toLowerCase().includes(q),
    );
  }, [listQuery.data, search]);

  /* ----- Åpne ny ----- */
  function openNew() {
    setForm(emptyForm(extraFields));
    setEditing(null);
    setCreating(true);
  }

  /* ----- Åpne rediger ----- */
  function openEdit(row: StamdataRow) {
    const extras: Record<string, string> = {};
    for (const f of extraFields) {
      const v = row[f.key];
      extras[f.key] = v == null ? "" : String(v);
    }
    setForm({
      code: row.code,
      display_name: row.display_name,
      description: row.description ?? "",
      sort_order: String(row.sort_order ?? 99),
      status: row.status ?? "active",
      ...extras,
    });
    setEditing(row);
    setCreating(false);
  }

  function closeForm() {
    setEditing(null);
    setCreating(false);
  }

  /* ----- Lagre (insert + update) ----- */
  async function save() {
    // Validering
    if (!form.code.trim()) {
      toast.error("Kode er påkrevd");
      return;
    }
    if (!codeRegex.test(form.code)) {
      toast.error("Kode må kun inneholde små bokstaver, tall og underscore");
      return;
    }
    if (!form.display_name.trim()) {
      toast.error("Navn er påkrevd");
      return;
    }
    for (const f of extraFields) {
      if (f.required && !form[f.key as keyof typeof form]) {
        toast.error(`${f.label} er påkrevd`);
        return;
      }
    }

    const usageCount = editing ? usageQuery.data?.[editing.id] ?? 0 : 0;
    const codeChanged = editing && editing.code !== form.code;
    if (codeChanged && usageCount > 0) {
      toast.error("Kan ikke endre kode på en kategori som er i bruk");
      return;
    }

    const payload: Record<string, unknown> = {
      legal_entity_id: legalEntityId,
      code: form.code.trim(),
      display_name: form.display_name.trim(),
      description: form.description.trim() || null,
      sort_order: Number(form.sort_order) || 99,
      status: form.status,
    };
    for (const f of extraFields) {
      payload[f.key] = form[f.key as keyof typeof form] || null;
    }

    setSaving(true);
    try {
      if (editing) {
        const { data, error } = await supabase
          .from(tableName as never)
          .update(payload as never)
          .eq("id", editing.id)
          .select()
          .single();
        if (error) throw error;
        const saved = data as unknown as StamdataRow;
        await logAudit({
          action: "update",
          entity_type: auditEntityType,
          entity_id: saved.id,
          entity_display_reference: saved.display_name,
          changes: payload,
        });
        toast.success("Oppdatert");
      } else {
        const { data, error } = await supabase
          .from(tableName as never)
          .insert(payload as never)
          .select()
          .single();
        if (error) throw error;
        const saved = data as unknown as StamdataRow;
        await logAudit({
          action: "create",
          entity_type: auditEntityType,
          entity_id: saved.id,
          entity_display_reference: saved.display_name,
          changes: payload,
        });
        toast.success("Opprettet");
      }
      qc.invalidateQueries({ queryKey: ["stamdata", tableName] });
      qc.invalidateQueries({ queryKey: ["stamdata-lookups"] });
      closeForm();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ukjent feil";
      if (msg.includes("duplicate") || msg.includes("unique")) {
        toast.error(`Koden "${form.code}" finnes allerede`);
      } else {
        toast.error(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  /* ----- Slett ----- */
  function openDelete(row: StamdataRow) {
    setDeleteConfirmText("");
    setDeleting(row);
  }

  async function confirmDelete() {
    if (!deleting) return;
    const usageCount = usageQuery.data?.[deleting.id] ?? 0;
    if (usageCount > 0) {
      toast.error(
        `Kan ikke slette — ${usageCount} produkt(er) bruker denne. Endre dem først.`,
      );
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from(tableName as never)
      .delete()
      .eq("id", deleting.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAudit({
      action: "delete",
      entity_type: auditEntityType,
      entity_id: deleting.id,
      entity_display_reference: deleting.display_name,
    });
    toast.success("Slettet");
    qc.invalidateQueries({ queryKey: ["stamdata", tableName] });
    qc.invalidateQueries({ queryKey: ["stamdata-lookups"] });
    setDeleting(null);
  }

  const lookups = lookupQueries.data ?? {};
  const isFormOpen = creating || editing !== null;
  const editingUsage = editing ? usageQuery.data?.[editing.id] ?? 0 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-app/10 text-app">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {canWrite && (
          <Button onClick={openNew} size="sm" className="bg-app hover:bg-app-dark text-app-foreground">
            <Plus className="mr-1.5 h-4 w-4" /> Ny
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Søk etter kode eller navn…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search ? "Ingen treff for søket." : "Ingen rader ennå. Opprett den første."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Kode</TableHead>
                  <TableHead>Navn</TableHead>
                  {extraColumns.map((c) => (
                    <TableHead key={c.header}>{c.header}</TableHead>
                  ))}
                  <TableHead className="hidden md:table-cell">Beskrivelse</TableHead>
                  <TableHead className="w-[80px] text-right">Sort</TableHead>
                  <TableHead className="w-[110px] text-right">I bruk</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[110px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const count = usageQuery.data?.[row.id] ?? 0;
                  const inactive = row.status !== "active";
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.code}</TableCell>
                      <TableCell className="font-medium">{row.display_name}</TableCell>
                      {extraColumns.map((c) => (
                        <TableCell key={c.header}>{c.render(row, lookups)}</TableCell>
                      ))}
                      <TableCell className="hidden max-w-[280px] truncate text-sm text-muted-foreground md:table-cell">
                        {row.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {row.sort_order}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {count}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            inactive
                              ? "border-muted-foreground/30 text-muted-foreground"
                              : "border-app/40 bg-app/10 text-app-dark"
                          }
                        >
                          {inactive ? "Inaktiv" : "Aktiv"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(row)}
                            disabled={!canWrite}
                            aria-label="Rediger"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDelete(row)}
                            disabled={!canWrite || count > 0}
                            aria-label="Slett"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Ny / rediger-modal */}
      <Dialog open={isFormOpen} onOpenChange={(o) => !o && closeForm()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Rediger" : "Ny"} — {title}</DialogTitle>
            {editing && editingUsage > 0 && (
              <DialogDescription>
                {editingUsage} produkt(er) bruker denne — koden kan ikke endres.
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="sd-code">Kode *</Label>
              <Input
                id="sd-code"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toLowerCase() })
                }
                placeholder="f.eks. b11"
                disabled={!!editing && editingUsage > 0}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Små bokstaver, tall og underscore. Må være unik.
              </p>
            </div>

            <div>
              <Label htmlFor="sd-name">Navn *</Label>
              <Input
                id="sd-name"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="f.eks. Skåret brød"
              />
            </div>

            {extraFields.map((f) => {
              const opts = lookups[f.lookupTable] ?? [];
              const filteredOpts = f.activeOnly ? opts.filter((o) => o.status === "active") : opts;
              return (
                <div key={f.key}>
                  <Label>{f.label}{f.required ? " *" : ""}</Label>
                  <Select
                    value={(form[f.key as keyof typeof form] as string) || undefined}
                    onValueChange={(v) => setForm({ ...form, [f.key]: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={`Velg ${f.label.toLowerCase()}…`} />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredOpts.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          <span className="font-mono text-xs">{o.code}</span>{" "}
                          — {o.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}

            <div>
              <Label htmlFor="sd-desc">Beskrivelse</Label>
              <Textarea
                id="sd-desc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sd-sort">Sort order</Label>
                <Input
                  id="sd-sort"
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sd-status">Status</Label>
                <div className="flex h-10 items-center gap-2">
                  <Switch
                    id="sd-status"
                    checked={form.status === "active"}
                    onCheckedChange={(c) =>
                      setForm({ ...form, status: c ? "active" : "inactive" })
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {form.status === "active" ? "Aktiv" : "Inaktiv"}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeForm} disabled={saving}>
              Avbryt
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="bg-app hover:bg-app-dark text-app-foreground"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Lagre" : "Opprett"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bekreft slett */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Slett "{deleting?.display_name}"?</DialogTitle>
            <DialogDescription>
              Skriv inn navnet under for å bekrefte. Handlingen kan ikke angres.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={deleting?.display_name}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={saving}>
              Avbryt
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={saving || deleteConfirmText !== deleting?.display_name}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Slett permanent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

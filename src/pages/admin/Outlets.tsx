import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Store, Plus, Pencil, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const OUTLET_TYPES = ["production", "cafe", "ice_cream", "kiosk", "pickup_point", "warehouse", "office"] as const;
const STATUSES = ["active", "inactive", "planned", "closed"] as const;

type Outlet = {
  id: string;
  legal_entity_id: string;
  short_name: string;
  full_name: string | null;
  outlet_type: string;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  status: string;
  display_number: number;
};

const empty: Partial<Outlet> = {
  short_name: "",
  full_name: "",
  outlet_type: "cafe",
  address_line1: "",
  postal_code: "",
  city: "",
  country: "NO",
  status: "active",
};

export default function Outlets() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState("all");
  const [editing, setEditing] = useState<Partial<Outlet> | null>(null);
  const [deleting, setDeleting] = useState<Outlet | null>(null);

  const { data: companies = [] } = useQuery({
    queryKey: ["admin-le-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, short_code, legal_name")
        .order("short_code");
      if (error) throw error;
      return data;
    },
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-outlets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outlets")
        .select("*")
        .order("short_name");
      if (error) throw error;
      return data as Outlet[];
    },
  });

  const companyMap = useMemo(
    () => new Map(companies.map((c: any) => [c.id, c])),
    [companies],
  );

  const filtered = data.filter((r) => {
    if (companyId !== "all" && r.legal_entity_id !== companyId) return false;
    const q = search.toLowerCase();
    return !q || r.short_name.toLowerCase().includes(q) || (r.full_name ?? "").toLowerCase().includes(q);
  });

  const save = useMutation({
    mutationFn: async (row: Partial<Outlet>) => {
      if (!row.legal_entity_id) throw new Error("Selskap er påkrevd");
      if (row.id) {
        const { id, display_number, ...patch } = row as any;
        const { error } = await supabase.from("outlets").update(patch).eq("id", id);
        if (error) throw error;
      } else {
        // Auto-tildel display_number = max+1 innen samme selskap (starter på 1)
        const { data: maxRow, error: maxErr } = await supabase
          .from("outlets")
          .select("display_number")
          .eq("legal_entity_id", row.legal_entity_id)
          .order("display_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (maxErr) throw maxErr;
        const nextNumber = (maxRow?.display_number ?? 0) + 1;
        const { error } = await supabase
          .from("outlets")
          .insert({ ...(row as any), display_number: nextNumber });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-outlets"] });
      toast.success("Lagret");
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleStatus = useMutation({
    mutationFn: async (row: Outlet) => {
      const next = row.status === "active" ? "inactive" : "active";
      const { error } = await supabase.from("outlets").update({ status: next }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-outlets"] });
      toast.success("Status oppdatert");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (row: Outlet) => {
      const { error } = await supabase.from("outlets").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-outlets"] });
      toast.success("Butikk slettet");
      setDeleting(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Kunne ikke slette"),
  });

  return (
    <AdminLayout title="Butikker">
      <AppHeaderBanner
        icon={Store}
        title="Butikker"
        subtitle="Butikker, bakerier og produksjonssteder."
        actions={
          <Button size="sm" onClick={() => setEditing({ ...empty })}>
            <Plus className="h-4 w-4" /> Ny butikk
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Søk navn…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle selskap</SelectItem>
            {companies.map((c: any) => (
              <SelectItem key={c.id} value={c.id}>{c.short_code} — {c.legal_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-line bg-surface-canvas">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Navn</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Selskap</TableHead>
              <TableHead>Adresse</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Handling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Laster…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Ingen treff</TableCell></TableRow>}
            {filtered.map((r) => {
              const le: any = companyMap.get(r.legal_entity_id);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.short_name}
                    {r.full_name && <div className="text-xs text-muted-foreground">{r.full_name}</div>}
                  </TableCell>
                  <TableCell><Badge variant="outline">{r.outlet_type}</Badge></TableCell>
                  <TableCell className="text-sm">{le ? `${le.short_code}` : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {[r.address_line1, r.postal_code, r.city].filter(Boolean).join(", ")}
                  </TableCell>
                  <TableCell><Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleStatus.mutate(r)}>
                      {r.status === "active" ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Rediger butikk" : "Ny butikk"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Selskap *</Label>
                <Select value={editing.legal_entity_id ?? ""} onValueChange={(v) => setEditing({ ...editing, legal_entity_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Velg…" /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.short_code} — {c.legal_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Field label="Kort navn *" value={editing.short_name ?? ""} onChange={(v) => setEditing({ ...editing, short_name: v })} />
              <div>
                <Label className="text-xs">Type *</Label>
                <Select value={editing.outlet_type ?? "cafe"} onValueChange={(v) => setEditing({ ...editing, outlet_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OUTLET_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Field label="Fullt navn" value={editing.full_name ?? ""} onChange={(v) => setEditing({ ...editing, full_name: v })} className="col-span-2" />
              <Field label="Adresse" value={editing.address_line1 ?? ""} onChange={(v) => setEditing({ ...editing, address_line1: v })} className="col-span-2" />
              <Field label="Postnr" value={editing.postal_code ?? ""} onChange={(v) => setEditing({ ...editing, postal_code: v })} />
              <Field label="By" value={editing.city ?? ""} onChange={(v) => setEditing({ ...editing, city: v })} />
              <Field label="Land" value={editing.country ?? "NO"} onChange={(v) => setEditing({ ...editing, country: v })} />
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={editing.status ?? "active"} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Avbryt</Button>
            <Button onClick={() => editing && save.mutate(editing)} disabled={save.isPending}>Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette butikk?</AlertDialogTitle>
            <AlertDialogDescription>
              Er du sikker på at du vil slette <strong>{deleting?.short_name}</strong>? Denne handlingen kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); deleting && remove.mutate(deleting); }}
              disabled={remove.isPending}
            >
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}

function Field({ label, value, onChange, className }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

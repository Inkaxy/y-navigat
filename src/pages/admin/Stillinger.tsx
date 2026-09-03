import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Briefcase, Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const CATEGORIES = ["production", "retail", "office", "logistics", "leadership", "platform", "support"] as const;
const SCOPES = ["single_outlet", "multi_outlet", "entire_legal_entity", "cross_company", "flexible"] as const;
const STATUSES = ["active", "deprecated"] as const;

type Position = {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  category: string;
  scope_pattern: string;
  status: string;
  sort_order: number;
};

const empty: Partial<Position> = {
  code: "",
  display_name: "",
  description: "",
  category: "office",
  scope_pattern: "single_outlet",
  status: "active",
  sort_order: 100,
};

export default function Stillinger() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState<Partial<Position> | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-positions-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as Position[];
    },
  });

  const { data: paaCounts = {} } = useQuery({
    queryKey: ["admin-paa-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("position_app_access")
        .select("position_id, level");
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const r of data ?? []) {
        if ((r as any).level !== "none") map[r.position_id] = (map[r.position_id] ?? 0) + 1;
      }
      return map;
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      return !q || p.display_name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
    });
  }, [data, search, category]);

  const save = useMutation({
    mutationFn: async (row: Partial<Position>) => {
      if (row.id) {
        const { id, ...patch } = row as any;
        const { error } = await supabase.from("positions").update(patch).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("positions").insert(row as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-positions-list"] });
      toast.success("Lagret");
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async (row: Position) => {
      const next = row.status === "active" ? "deprecated" : "active";
      const { error } = await supabase.from("positions").update({ status: next }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-positions-list"] });
      toast.success("Status oppdatert");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AdminLayout title="Stillinger">
      <AppHeaderBanner
        icon={Briefcase}
        title="Stillinger"
        subtitle="Stillingsmaler for bakeriet."
        actions={
          <Button size="sm" onClick={() => setEditing({ ...empty })}>
            <Plus className="h-4 w-4" /> Ny stilling
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Søk navn eller kode…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle kategorier</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-line bg-surface-canvas">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stilling</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Apper med tilgang</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Handling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Laster…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Ingen treff</TableCell></TableRow>}
            {filtered.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">
                  <Link to={`/admin/stillinger/${p.id}`} className="hover:text-app hover:underline">{p.display_name}</Link>
                  <div className="font-mono text-[10px] text-muted-foreground">{p.code}</div>
                </TableCell>
                <TableCell><Badge variant="outline">{p.category}</Badge></TableCell>
                <TableCell><Badge variant="outline">{p.scope_pattern}</Badge></TableCell>
                <TableCell>{paaCounts[p.id] ?? 0}</TableCell>
                <TableCell><Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(p)}>
                    {p.status === "active" ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Rediger stilling" : "Ny stilling"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Kode *</Label>
                <Input value={editing.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} disabled={!!editing.id} />
                {editing.id && <p className="mt-1 text-[10px] text-muted-foreground">Kode kan ikke endres etter opprettelse.</p>}
              </div>
              <div>
                <Label className="text-xs">Sortering</Label>
                <Input type="number" value={editing.sort_order ?? 100} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Visningsnavn *</Label>
                <Input value={editing.display_name ?? ""} onChange={(e) => setEditing({ ...editing, display_name: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Kategori *</Label>
                <Select value={editing.category ?? "office"} onValueChange={(v) => setEditing({ ...editing, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Scope *</Label>
                <Select value={editing.scope_pattern ?? "single_outlet"} onValueChange={(v) => setEditing({ ...editing, scope_pattern: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCOPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Beskrivelse</Label>
                <Textarea value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} />
              </div>
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
    </AdminLayout>
  );
}

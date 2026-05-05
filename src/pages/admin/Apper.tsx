import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { AppWindow, Plus, Pencil } from "lucide-react";
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
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

const ACCESS_PATTERNS = [
  "single_company",
  "authored_single_consumed_multi",
  "multi_company",
  "cross_company",
  "dual_surface",
] as const;

const STATUSES = ["planned", "in_development", "active", "deprecated", "disabled"] as const;
const CATEGORIES = ["platform", "masterdata", "operations", "retail", "finance", "analytics", "public", "hr"] as const;

type App = {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  status: string;
  access_pattern: string;
  category: string;
  deploy_url: string | null;
  start_path: string;
  color_hex: string;
  sort_order: number;
};

const empty: Partial<App> = {
  code: "",
  display_name: "",
  description: "",
  status: "in_development",
  access_pattern: "single_company",
  category: "operations",
  deploy_url: "",
  start_path: "/",
  color_hex: "#0EA5E9",
  sort_order: 100,
};

export default function Apper() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<Partial<App> | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-apps-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("apps").select("*").order("sort_order");
      if (error) throw error;
      return data as App[];
    },
  });

  const filtered = data.filter((a) => statusFilter === "all" || a.status === statusFilter);

  const save = useMutation({
    mutationFn: async (row: Partial<App>) => {
      if (row.id) {
        const { id, code, created_at, updated_at, ...patch } = row as any;
        // code er låst — ikke send med
        const { error } = await supabase.from("apps").update(patch).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("apps").insert(row as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-apps-list"] });
      toast.success("Lagret");
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: async (row: App) => {
      const next = row.status === "deprecated" ? "active" : "deprecated";
      const { error } = await supabase.from("apps").update({ status: next }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-apps-list"] });
      toast.success("Status oppdatert");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AdminLayout title="Apper">
      <AppHeaderBanner
        icon={AppWindow}
        title="Apper"
        subtitle="Registrerte NBOS-apper og status."
        actions={
          <Button size="sm" onClick={() => setEditing({ ...empty })}>
            <Plus className="h-4 w-4" /> Ny app
          </Button>
        }
      />

      <div className="flex items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statuser</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-line bg-surface-canvas">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Navn</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Access pattern</TableHead>
              <TableHead>Deploy URL</TableHead>
              <TableHead className="text-right">Handling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Laster…</TableCell></TableRow>}
            {filtered.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-mono text-xs">{a.code}</TableCell>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color_hex }} />
                    {a.display_name}
                  </span>
                </TableCell>
                <TableCell><Badge variant={a.status === "active" ? "default" : "secondary"}>{a.status}</Badge></TableCell>
                <TableCell className="text-xs">{a.access_pattern}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{a.deploy_url ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => archive.mutate(a)}>
                    {a.status === "deprecated" ? "Reaktiver" : "Arkivér"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Rediger app" : "Ny app"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Kode *</Label>
                {editing.id ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span><Input value={editing.code ?? ""} disabled /></span>
                    </TooltipTrigger>
                    <TooltipContent>Kode kan ikke endres etter opprettelse — refereres mange steder.</TooltipContent>
                  </Tooltip>
                ) : (
                  <Input value={editing.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
                )}
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
                <Label className="text-xs">Status *</Label>
                <Select value={editing.status ?? "in_development"} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Kategori *</Label>
                <Select value={editing.category ?? "operations"} onValueChange={(v) => setEditing({ ...editing, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Access pattern *</Label>
                <Select value={editing.access_pattern ?? "single_company"} onValueChange={(v) => setEditing({ ...editing, access_pattern: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCESS_PATTERNS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Deploy URL</Label>
                <Input value={editing.deploy_url ?? ""} onChange={(e) => setEditing({ ...editing, deploy_url: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Start-path *</Label>
                <Input value={editing.start_path ?? "/"} onChange={(e) => setEditing({ ...editing, start_path: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Farge (hex) *</Label>
                <Input value={editing.color_hex ?? "#0EA5E9"} onChange={(e) => setEditing({ ...editing, color_hex: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Beskrivelse</Label>
                <Textarea value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} />
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

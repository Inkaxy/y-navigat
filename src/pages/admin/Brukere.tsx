import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Users, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useIsPlatformOwner } from "@/hooks/useIsPlatformOwner";
import { InviteUserDialog } from "./components/InviteUserDialog";

type Row = {
  id: string;
  display_name: string;
  email: string;
  status: string;
  last_login_at: string | null;
  active_count: number;
  legal_entity_ids: string[];
};

export default function Brukere() {
  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState<string>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const qc = useQueryClient();
  const { data: isOwner = false } = useIsPlatformOwner();

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
    queryKey: ["admin-users"],
    queryFn: async (): Promise<Row[]> => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: users, error: e1 }, { data: positions, error: e2 }] = await Promise.all([
        supabase.from("users").select("id, display_name, email, status, last_login_at").order("display_name"),
        supabase.from("user_positions").select("user_id, legal_entity_id, valid_from, valid_to"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const byUser = new Map<string, { active: number; les: Set<string> }>();
      for (const p of positions ?? []) {
        const isActive = (p.valid_from as any) <= today && (!p.valid_to || (p.valid_to as any) > today);
        if (!isActive) continue;
        const cur = byUser.get(p.user_id) ?? { active: 0, les: new Set() };
        cur.active += 1;
        cur.les.add(p.legal_entity_id);
        byUser.set(p.user_id, cur);
      }
      return (users ?? []).map((u: any) => {
        const agg = byUser.get(u.id);
        return {
          ...u,
          active_count: agg?.active ?? 0,
          legal_entity_ids: agg ? Array.from(agg.les) : [],
        };
      });
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.filter((r) => {
      if (companyId !== "all" && !r.legal_entity_ids.includes(companyId)) return false;
      if (!q) return true;
      return r.display_name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
    });
  }, [data, search, companyId]);

  return (
    <AdminLayout title="Brukere">
      <AppHeaderBanner
        icon={Users}
        title="Brukere"
        subtitle="Ansatte og deres stillinger."
        actions={
          isOwner ? (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" /> Inviter bruker
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Søk navn eller e-post…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Alle selskap" /></SelectTrigger>
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
              <TableHead>E-post</TableHead>
              <TableHead>Aktive stillinger</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sist innlogget</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Laster…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Ingen treff</TableCell></TableRow>}
            {filtered.map((u) => (
              <TableRow key={u.id} className="cursor-pointer">
                <TableCell className="font-medium">
                  <Link to={`/admin/brukere/${u.id}`} className="hover:text-app hover:underline">{u.display_name}</Link>
                </TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>{u.active_count}</TableCell>
                <TableCell><Badge variant={u.status === "active" ? "default" : "secondary"}>{u.status}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString("no-NO") : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => qc.invalidateQueries({ queryKey: ["admin-users"] })}
      />
    </AdminLayout>
  );
}

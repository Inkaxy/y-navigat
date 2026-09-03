import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Users, UserPlus, KeyRound, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { useIsPlatformOwner } from "@/hooks/useIsPlatformOwner";
import { InviteUserDialog } from "./components/InviteUserDialog";
import { CreateUserDialog } from "./components/CreateUserDialog";
import { toast } from "sonner";
import { osloTodayISO } from "@/lib/osloDate";

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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data: isOwner = false } = useIsPlatformOwner();

  const resendInvite = async (u: Row) => {
    setResendingId(u.id);
    const [first, ...rest] = (u.display_name ?? "").split(" ");
    const last = rest.join(" ") || first;
    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: {
        email: u.email,
        first_name: first || u.email,
        last_name: last,
        assignments: [],
        resend: true,
      },
    });
    setResendingId(null);
    if (error || (data as any)?.error) {
      toast.error("Kunne ikke sende ny kode", { description: (data as any)?.error ?? error?.message });
      return;
    }
    const d = data as { email_sent?: boolean; code?: string | null };
    if (d.email_sent) {
      toast.success(`Ny kode sendt til ${u.email}`);
    } else if (d.code) {
      try { await navigator.clipboard.writeText(d.code); } catch { /* ignore */ }
      toast.warning(`E-post feilet — kode ${d.code} kopiert til utklippstavlen`);
    }
  };


  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<Row[]> => {
      const today = osloTodayISO();
      const [{ data: users, error: e1 }, { data: positions, error: e2 }] = await Promise.all([
        supabase.from("users").select("id, display_name, email, status, last_login_at").neq("status", "deleted").order("display_name"),
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
      if (!q) return true;
      return r.display_name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
    });
  }, [data, search]);

  return (
    <AdminLayout title="Brukere">
      <AppHeaderBanner
        icon={Users}
        title="Brukere"
        subtitle="Ansatte og deres stillinger."
        actions={
          isOwner ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                <KeyRound className="h-4 w-4" /> Opprett med passord
              </Button>
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-4 w-4" /> Inviter bruker
              </Button>
            </div>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Søk navn eller e-post…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
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
              <TableHead className="w-[140px] text-right">Handling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Laster…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Ingen treff</TableCell></TableRow>}
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
                <TableCell className="text-right">
                  {isOwner && u.status === "onboarding" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resendingId === u.id}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); resendInvite(u); }}
                    >
                      <Send className="h-3.5 w-3.5" />
                      {resendingId === u.id ? "Sender…" : "Send ny kode"}
                    </Button>
                  )}
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
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ["admin-users"] })}
      />
    </AdminLayout>
  );
}

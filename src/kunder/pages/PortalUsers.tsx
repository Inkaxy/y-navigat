import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, UserPlus, Send, Ban, CheckCircle2, Trash2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppBanner } from "@/kunder/components/shell/AppBanner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InvitePortalUserDialog } from "@/kunder/components/portal/InvitePortalUserDialog";
import { PortalUserDrawer } from "@/kunder/components/portal/PortalUserDrawer";

type PortalRow = {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
  status: string;
  last_login_at: string | null;
  customers: { id: string; customer_number: number | null; display_name: string }[];
};

export default function PortalUsers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<PortalRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["portal-users"],
    queryFn: async (): Promise<PortalRow[]> => {
      const [{ data: profiles, error: pe }, { data: links, error: le }] = await Promise.all([
        supabase.from("portal_user_profiles").select("*").order("display_name"),
        supabase.from("customer_portal_accounts").select("user_id, customer_id, customers(id, customer_number, display_name)"),
      ]);
      if (pe) throw pe;
      if (le) throw le;
      const byUser = new Map<string, { id: string; customer_number: number | null; display_name: string }[]>();
      for (const l of (links ?? []) as any[]) {
        if (!l.customers) continue;
        const arr = byUser.get(l.user_id) ?? [];
        arr.push(l.customers);
        byUser.set(l.user_id, arr);
      }
      return (profiles ?? []).map((p: any) => ({
        ...p,
        customers: (byUser.get(p.user_id) ?? []).sort((a, b) => a.display_name.localeCompare(b.display_name, "nb")),
      }));
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return data;
    return data.filter((r) =>
      r.display_name.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      r.customers.some((c) => c.display_name.toLowerCase().includes(q) || String(c.customer_number ?? "").includes(q)),
    );
  }, [data, search]);

  const runAction = async (row: PortalRow, action: "recovery" | "disable" | "enable") => {
    setBusy(`${action}:${row.user_id}`);
    const { data: res, error } = await supabase.functions.invoke("portal-manage-user", {
      body: { action, user_id: row.user_id },
    });
    setBusy(null);
    if (error || (res as any)?.error) {
      toast.error("Handling feilet", { description: (res as any)?.error ?? error?.message });
      return;
    }
    toast.success(
      action === "recovery" ? `Passord-recovery sendt til ${row.email}` :
      action === "disable" ? `${row.display_name} deaktivert` :
      `${row.display_name} aktivert`,
    );
    qc.invalidateQueries({ queryKey: ["portal-users"] });
  };

  return (
    <div className="space-y-4 p-6">
      <AppBanner
        title="Portaltilgang"
        subtitle="Kundeportal-brukere og hvilke kunder de har tilgang til."
        icon={KeyRound}
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" /> Inviter portal-bruker
          </Button>
        }
      />

      <div className="flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Søk navn, e-post eller kunde…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-sm text-muted-foreground">{filtered.length} brukere</span>
      </div>

      <div className="rounded-md border border-line bg-surface-canvas">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Navn</TableHead>
              <TableHead>E-post</TableHead>
              <TableHead>Rolle</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Kunder</TableHead>
              <TableHead className="text-right">Handlinger</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                Ingen portal-brukere ennå. Klikk «Inviter portal-bruker» for å komme i gang.
              </TableCell></TableRow>
            )}
            {filtered.map((u) => (
              <TableRow key={u.user_id} className="cursor-pointer" onClick={() => setSelectedUser(u)}>
                <TableCell className="font-medium">{u.display_name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell><Badge variant="outline">{u.role}</Badge></TableCell>
                <TableCell>
                  <Badge variant={u.status === "active" ? "default" : u.status === "disabled" ? "destructive" : "secondary"}>
                    {u.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5 text-sm">
                    {u.customers.length === 0 && <span className="text-muted-foreground">—</span>}
                    {u.customers.slice(0, 6).map((c) => (
                      <span key={c.id}>{c.display_name}{c.customer_number ? ` (${c.customer_number})` : ""}</span>
                    ))}
                    {u.customers.length > 6 && (
                      <span className="text-muted-foreground">+{u.customers.length - 6} til</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" disabled={!!busy}
                      onClick={() => runAction(u, "recovery")} title="Send passord-recovery">
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                    {u.status === "disabled" ? (
                      <Button size="sm" variant="ghost" disabled={!!busy}
                        onClick={() => runAction(u, "enable")} title="Aktiver">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={!!busy}
                        onClick={() => runAction(u, "disable")} title="Deaktiver">
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <InvitePortalUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => qc.invalidateQueries({ queryKey: ["portal-users"] })}
      />
      <PortalUserDrawer
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        onChanged={() => qc.invalidateQueries({ queryKey: ["portal-users"] })}
      />
    </div>
  );
}

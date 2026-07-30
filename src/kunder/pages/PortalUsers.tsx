import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, UserPlus, Send, Mail, Ban, CheckCircle2, Trash2, Search, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { AppBanner } from "@/kunder/components/shell/AppBanner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { InvitePortalUserDialog } from "@/kunder/components/portal/InvitePortalUserDialog";
import { PortalUserDrawer } from "@/kunder/components/portal/PortalUserDrawer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useKunderWriteAccess } from "@/kunder/hooks/useKunderWriteAccess";
import { ALL_ENTITIES, useSelectedEntity } from "@/kunder/state/SelectedEntityContext";

type PortalRow = {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
  status: string;
  last_login_at: string | null;
  customers: { id: string; customer_number: string | number | null; display_name: string; legal_entity_id: string }[];
};

export default function PortalUsers() {
  const qc = useQueryClient();
  const { selected } = useSelectedEntity();
  const { data: canWrite = false } = useKunderWriteAccess();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<PortalRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["portal-users"],
    queryFn: async (): Promise<PortalRow[]> => {
      const [{ data: profiles, error: pe }, { data: links, error: le }] = await Promise.all([
        supabase.from("portal_user_profiles").select("*").order("display_name"),
        supabase.from("customer_portal_accounts").select("user_id, customer_id, customers(id, customer_number, display_name, legal_entity_id)"),
      ]);
      if (pe) throw pe;
      if (le) throw le;
      const byUser = new Map<string, { id: string; customer_number: string | number | null; display_name: string; legal_entity_id: string }[]>();
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

  const roleOptions = useMemo(
    () => Array.from(new Set(scopedData.map((r) => r.role).filter(Boolean))).sort(),
    [scopedData],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(scopedData.map((r) => r.status).filter(Boolean))).sort(),
    [scopedData],
  );
  // Kun kunder/portal-brukere tilhørende valgt selskap vises — hindrer at
  // brukere ser andre selskapers kunder/portal-brukere.
  const scopedData = useMemo(() => {
    if (!selected || selected === ALL_ENTITIES) return data;
    return data
      .map((r) => ({ ...r, customers: r.customers.filter((c) => c.legal_entity_id === selected) }))
      .filter((r) => r.customers.length > 0);
  }, [data, selected]);

  const customerOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string; num: string | number | null }>();
    for (const r of scopedData) {
      for (const c of r.customers) {
        if (!map.has(c.id)) map.set(c.id, { id: c.id, label: c.display_name, num: c.customer_number });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "nb"));
  }, [scopedData]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return scopedData.filter((r) => {
      if (roleFilter !== "all" && r.role !== roleFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (customerFilter !== "all" && !r.customers.some((c) => c.id === customerFilter)) return false;
      if (!q) return true;
      return (
        r.display_name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.customers.some((c) => c.display_name.toLowerCase().includes(q) || String(c.customer_number ?? "").includes(q))
      );
    });
  }, [scopedData, search, roleFilter, statusFilter, customerFilter]);

  const hasActiveFilters =
    search !== "" || roleFilter !== "all" || statusFilter !== "all" || customerFilter !== "all";
  const clearFilters = () => {
    setSearch("");
    setRoleFilter("all");
    setStatusFilter("all");
    setCustomerFilter("all");
  };

  const runAction = async (row: PortalRow, action: "recovery" | "disable" | "enable" | "resend_invite") => {
    if (!canWrite) return;
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
      action === "resend_invite" ? `Ny invitasjon sendt til ${row.email}` :
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
          canWrite ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" /> Inviter portal-bruker
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button disabled>
                    <UserPlus className="h-4 w-4" /> Inviter portal-bruker
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Du har kun lesetilgang til Kunder.</TooltipContent>
            </Tooltip>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Søk navn, e-post eller kunde…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Alle roller" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle roller</SelectItem>
            {roleOptions.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Alle statuser" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statuser</SelectItem>
            {statusOptions.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={customerFilter} onValueChange={setCustomerFilter}>
          <SelectTrigger className="w-[240px]"><SelectValue placeholder="Alle kunder" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle kunder</SelectItem>
            {customerOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}{c.num ? ` (${c.num})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4" /> Nullstill
          </Button>
        )}
        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} brukere</span>
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
                    <Button size="sm" variant="ghost" disabled={!!busy || !canWrite}
                      onClick={() => runAction(u, "resend_invite")}
                      title={canWrite ? "Send ny invitasjon (magic link)" : "Du har kun lesetilgang til Kunder"}>
                      <Mail className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!!busy || !canWrite}
                      onClick={() => runAction(u, "recovery")}
                      title={canWrite ? "Send passord-recovery" : "Du har kun lesetilgang til Kunder"}>
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                    {u.status === "disabled" ? (
                      <Button size="sm" variant="ghost" disabled={!!busy || !canWrite}
                        onClick={() => runAction(u, "enable")}
                        title={canWrite ? "Aktiver" : "Du har kun lesetilgang til Kunder"}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={!!busy || !canWrite}
                        onClick={() => runAction(u, "disable")}
                        title={canWrite ? "Deaktiver" : "Du har kun lesetilgang til Kunder"}>
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
        open={inviteOpen && canWrite}
        onOpenChange={setInviteOpen}
        onInvited={() => qc.invalidateQueries({ queryKey: ["portal-users"] })}
      />
      <PortalUserDrawer
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        onChanged={() => qc.invalidateQueries({ queryKey: ["portal-users"] })}
        canWrite={canWrite}
      />
    </div>
  );
}

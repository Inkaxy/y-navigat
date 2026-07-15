import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { X, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface PortalRow {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
  status: string;
  customers: { id: string; customer_number: string | number | null; display_name: string }[];
}

interface Props {
  user: PortalRow | null;
  onClose: () => void;
  onChanged: () => void;
}

export function PortalUserDrawer({ user, onClose, onChanged }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"kunde" | "admin">("kunde");
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name);
      setRole((user.role === "admin" ? "admin" : "kunde"));
      setCustomerIds(user.customers.map((c) => c.id));
      setCustomerSearch("");
    }
  }, [user]);

  const { data: customers = [] } = useQuery({
    queryKey: ["portal-drawer-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, customer_number, display_name")
        .order("display_name")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; customer_number: string | number | null; display_name: string }[];
    },
    enabled: !!user,
  });

  const selectedCustomers = useMemo(
    () => customers.filter((c) => customerIds.includes(c.id)),
    [customers, customerIds],
  );

  const availableCustomers = useMemo(() => {
    const q = customerSearch.toLowerCase().trim();
    const base = customers.filter((c) => !customerIds.includes(c.id));
    if (!q) return base.slice(0, 100);
    return base.filter((c) =>
      c.display_name.toLowerCase().includes(q) || String(c.customer_number ?? "").includes(q),
    ).slice(0, 100);
  }, [customers, customerIds, customerSearch]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { data: p, error: pe } = await supabase.functions.invoke("portal-manage-user", {
      body: { action: "update_profile", user_id: user.user_id, display_name: displayName, role },
    });
    if (pe || (p as any)?.error) {
      setSaving(false);
      toast.error("Kunne ikke lagre profil", { description: (p as any)?.error ?? pe?.message });
      return;
    }
    const { data: c, error: ce } = await supabase.functions.invoke("portal-manage-user", {
      body: { action: "set_customers", user_id: user.user_id, customer_ids: customerIds },
    });
    setSaving(false);
    if (ce || (c as any)?.error) {
      toast.error("Kunne ikke oppdatere kunder", { description: (c as any)?.error ?? ce?.message });
      return;
    }
    toast.success("Lagret");
    onChanged();
    onClose();
  };

  const deleteUser = async () => {
    if (!user) return;
    const { data, error } = await supabase.functions.invoke("portal-manage-user", {
      body: { action: "delete", user_id: user.user_id },
    });
    if (error || (data as any)?.error) {
      toast.error("Sletting feilet", { description: (data as any)?.error ?? error?.message });
      return;
    }
    toast.success("Portal-bruker slettet");
    onChanged();
    onClose();
  };

  return (
    <Sheet open={!!user} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{user?.display_name}</SheetTitle>
          <SheetDescription>{user?.email}</SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-1.5">
            <Label>Visningsnavn</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Rolle</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "kunde" | "admin")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="kunde">Kunde</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Kunder ({selectedCustomers.length})</Label>
            <div className="flex flex-wrap gap-1 min-h-8 rounded-md border border-line p-2 bg-surface-canvas">
              {selectedCustomers.length === 0 && (
                <span className="text-xs text-muted-foreground">Ingen kunder</span>
              )}
              {selectedCustomers.map((c) => (
                <Badge key={c.id} variant="secondary" className="gap-1">
                  {c.display_name}{c.customer_number ? ` (${c.customer_number})` : ""}
                  <button type="button" onClick={() => setCustomerIds((p) => p.filter((id) => id !== c.id))}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <Input
              placeholder="Søk kunde å legge til…"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
            />
            <ScrollArea className="h-40 rounded-md border border-line">
              <div className="p-1">
                {availableCustomers.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">Ingen treff</p>
                )}
                {availableCustomers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCustomerIds((p) => [...p, c.id])}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-surface-raised"
                  >
                    <span>{c.display_name}</span>
                    <span className="text-muted-foreground">{c.customer_number ?? ""}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        <SheetFooter className="flex-row justify-between sm:justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm"><Trash2 className="h-4 w-4" /> Slett</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Slette portal-bruker?</AlertDialogTitle>
                <AlertDialogDescription>
                  Dette fjerner auth-brukeren og alle portal-koblinger. Kan ikke angres.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Avbryt</AlertDialogCancel>
                <AlertDialogAction onClick={deleteUser}>Slett</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Avbryt</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Lagrer…" : "Lagre"}</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

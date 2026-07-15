import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onInvited?: () => void;
  defaultCustomerId?: string;
}

export function InvitePortalUserDialog({ open, onOpenChange, onInvited, defaultCustomerId }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"kunde" | "admin">("kunde");
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setFirstName(""); setLastName(""); setEmail(""); setRole("kunde");
      setCustomerIds(defaultCustomerId ? [defaultCustomerId] : []);
      setCustomerSearch("");
    }
  }, [open, defaultCustomerId]);

  const { data: customers = [] } = useQuery({
    queryKey: ["portal-invite-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, customer_number, display_name, primary_contact_name, primary_contact_email, invoice_email")
        .order("display_name")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        customer_number: string | number | null;
        display_name: string;
        primary_contact_name: string | null;
        primary_contact_email: string | null;
        invoice_email: string | null;
      }[];
    },
    enabled: open,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["portal-invite-contacts", customerIds],
    queryFn: async () => {
      if (customerIds.length === 0) return [];
      const { data, error } = await supabase
        .from("customer_contacts")
        .select("id, customer_id, name, email")
        .in("customer_id", customerIds)
        .not("email", "is", null);
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string; customer_id: string; name: string | null; email: string | null;
      }[];
    },
    enabled: open && customerIds.length > 0,
  });

  const suggestedEmails = useMemo(() => {
    const seen = new Set<string>();
    const out: { email: string; name: string | null; source: string }[] = [];
    const push = (email: string | null | undefined, name: string | null | undefined, source: string) => {
      if (!email) return;
      const key = email.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ email: key, name: name?.trim() || null, source });
    };
    for (const c of customers.filter((c) => customerIds.includes(c.id))) {
      const label = c.display_name;
      push(c.primary_contact_email, c.primary_contact_name, `${label} · hovedkontakt`);
      push(c.invoice_email, null, `${label} · faktura`);
    }
    for (const k of contacts) {
      const cust = customers.find((c) => c.id === k.customer_id);
      push(k.email, k.name, `${cust?.display_name ?? "Kunde"} · kontakt`);
    }
    return out;
  }, [customers, contacts, customerIds]);

  const applySuggested = (s: { email: string; name: string | null }) => {
    setEmail(s.email);
    if (s.name && !firstName && !lastName) {
      const parts = s.name.split(/\s+/);
      setFirstName(parts[0] ?? "");
      setLastName(parts.slice(1).join(" ") || parts[0] || "");
    }
  };

  const selectedCustomers = useMemo(
    () => customers.filter((c) => customerIds.includes(c.id)),
    [customers, customerIds],
  );

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.toLowerCase().trim();
    const base = customers.filter((c) => !customerIds.includes(c.id));
    if (!q) return base.slice(0, 100);
    return base.filter((c) =>
      c.display_name.toLowerCase().includes(q) || String(c.customer_number ?? "").includes(q),
    ).slice(0, 100);
  }, [customers, customerIds, customerSearch]);

  const submit = async () => {
    if (!firstName || !lastName || !email) return toast.error("Navn og e-post er påkrevd");
    if (customerIds.length === 0) return toast.error("Velg minst én kunde");
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("portal-invite-user", {
      body: { first_name: firstName, last_name: lastName, email, role, customer_ids: customerIds },
    });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      toast.error("Invitasjon feilet", { description: (data as any)?.error ?? error?.message });
      return;
    }
    toast.success(`Portal-invitasjon sendt til ${email}`);
    onOpenChange(false);
    onInvited?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Inviter portal-bruker</DialogTitle>
          <DialogDescription>
            Brukeren mottar en e-post fra Supabase for å sette passord, og får tilgang til de valgte kundene i kundeportalen.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fornavn</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Etternavn</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>E-post</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
          </div>

          {suggestedEmails.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                E-poster fra valgte kundekort — klikk for å bruke
              </Label>
              <div className="flex flex-wrap gap-1 rounded-md border border-line bg-surface-canvas p-2">
                {suggestedEmails.slice(0, 20).map((s) => (
                  <button
                    key={`${s.email}-${s.source}`}
                    type="button"
                    onClick={() => applySuggested(s)}
                    className={
                      "rounded border border-line px-2 py-1 text-left text-xs hover:bg-surface-raised " +
                      (email.toLowerCase() === s.email ? "border-primary bg-primary/10" : "")
                    }
                    title={s.source}
                  >
                    <div className="font-medium">{s.email}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {s.name ? `${s.name} · ` : ""}{s.source}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}


          <div className="space-y-1.5">
            <Label>Kunder ({selectedCustomers.length} valgt)</Label>
            <div className="flex flex-wrap gap-1 min-h-8 rounded-md border border-line p-2 bg-surface-canvas">
              {selectedCustomers.length === 0 && (
                <span className="text-xs text-muted-foreground">Ingen valgt ennå</span>
              )}
              {selectedCustomers.map((c) => (
                <Badge key={c.id} variant="secondary" className="gap-1">
                  {c.display_name}{c.customer_number ? ` (${c.customer_number})` : ""}
                  <button
                    type="button"
                    onClick={() => setCustomerIds((prev) => prev.filter((id) => id !== c.id))}
                    className="hover:text-destructive"
                  >
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
                {filteredCustomers.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">Ingen treff</p>
                )}
                {filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCustomerIds((prev) => [...prev, c.id])}
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Avbryt</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Sender…" : "Send invitasjon"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

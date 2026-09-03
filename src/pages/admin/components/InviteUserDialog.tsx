import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/hooks/useCompany";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onInvited?: () => void;
}

type Assignment = { position_id: string };

export function InviteUserDialog({ open, onOpenChange, onInvited }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const { data: company } = useCompany();
  const [assignments, setAssignments] = useState<Assignment[]>([{ position_id: "" }]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setFirstName(""); setLastName(""); setEmail("");
      setAssignments([{ position_id: "" }]);
      setSubmitting(false);
    }
  }, [open]);


  const { data: positions = [] } = useQuery({
    queryKey: ["invite-position-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("id, code, display_name, status")
        .eq("status", "active")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const updateAssignment = (idx: number, patch: Partial<Assignment>) => {
    setAssignments((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };
  const addRow = () =>
    setAssignments((prev) => [...prev, { position_id: "" }]);
  const removeRow = (idx: number) =>
    setAssignments((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (!firstName || !lastName || !email) {
      toast.error("Navn og e-post er påkrevd");
      return;
    }
    if (!company) {
      toast.error("Fant ikke firmaet");
      return;
    }
    const cleaned = assignments
      .filter((a) => a.position_id)
      .map((a) => ({ legal_entity_id: company.id, position_id: a.position_id }));
    if (cleaned.length === 0) {
      toast.error("Minst én stilling må fylles ut");
      return;
    }
    // Dedup på (selskap, stilling)
    const seen = new Set<string>();
    for (const a of cleaned) {
      if (seen.has(a.position_id)) {
        toast.error("Samme stilling er lagt til to ganger");
        return;
      }
      seen.add(a.position_id);
    }

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: {
        email,
        first_name: firstName,
        last_name: lastName,
        assignments: cleaned,
      },
    });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      toast.error("Invitasjon mislyktes", {
        description: (data as any)?.error ?? error?.message,
      });
      return;
    }
    const d = data as {
      email_sent?: boolean;
      email_error?: string | null;
      sent_from?: string | null;
      code?: string | null;
      activate_url?: string | null;
      expires_at?: string | null;
    };
    if (d.email_sent) {
      toast.success(`Invitasjon sendt til ${email}`, {
        description: `Koden er gyldig i 7 dager. ${d.sent_from ? `Sendt fra ${d.sent_from}.` : ""}`,
      });
    } else {
      toast.warning("Bruker opprettet, men e-post ble ikke sendt", {
        description: d.email_error ?? "Del koden manuelt med brukeren.",
        duration: 20000,
      });
      if (d.code && d.activate_url) {
        const text = `Aktiveringskode: ${d.code}\nGå til: ${d.activate_url}`;
        try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
        toast.info(`Kode ${d.code} kopiert til utklippstavlen`, { duration: 15000 });
      }
    }
    onOpenChange(false);
    onInvited?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Inviter ny bruker</DialogTitle>
          <DialogDescription>
            Brukeren mottar en e-post med en 6-sifret aktiveringskode. Koden er gyldig i 7 dager. Du kan tilordne flere stillinger.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="first_name">Fornavn</Label>
              <Input id="first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name">Etternavn</Label>
              <Input id="last_name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">E-post</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Stillinger</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addRow}>
                <Plus className="h-4 w-4" /> Legg til
              </Button>
            </div>
            {assignments.map((a, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_auto] gap-2 items-center">
                <Select
                  value={a.position_id}
                  onValueChange={(v) => updateAssignment(idx, { position_id: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Stilling" /></SelectTrigger>
                  <SelectContent>
                    {positions.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(idx)}
                  disabled={assignments.length === 1}
                  aria-label="Fjern stilling"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Første rad blir markert som primær stilling.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Avbryt
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Sender…" : "Send invitasjon"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

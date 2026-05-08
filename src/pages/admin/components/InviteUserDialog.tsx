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
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onInvited?: () => void;
}

export function InviteUserDialog({ open, onOpenChange, onInvited }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [legalEntityId, setLegalEntityId] = useState<string>("");
  const [positionId, setPositionId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setFirstName(""); setLastName(""); setEmail("");
      setLegalEntityId(""); setPositionId(""); setSubmitting(false);
    }
  }, [open]);

  const { data: companies = [] } = useQuery({
    queryKey: ["invite-le-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, short_code, legal_name")
        .order("short_code");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

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

  const submit = async () => {
    if (!firstName || !lastName || !email || !legalEntityId || !positionId) {
      toast.error("Alle felt er påkrevd");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: {
        email,
        first_name: firstName,
        last_name: lastName,
        legal_entity_id: legalEntityId,
        position_id: positionId,
      },
    });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      toast.error("Invitasjon mislyktes", {
        description: (data as any)?.error ?? error?.message,
      });
      return;
    }
    toast.success(`Invitasjon sendt til ${email}`);
    onOpenChange(false);
    onInvited?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inviter ny bruker</DialogTitle>
          <DialogDescription>
            Brukeren mottar en e-post med lenke for å sette passord.
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
          <div className="space-y-1.5">
            <Label>Selskap</Label>
            <Select value={legalEntityId} onValueChange={setLegalEntityId}>
              <SelectTrigger><SelectValue placeholder="Velg selskap" /></SelectTrigger>
              <SelectContent>
                {companies.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.short_code} — {c.legal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Stilling</Label>
            <Select value={positionId} onValueChange={setPositionId}>
              <SelectTrigger><SelectValue placeholder="Velg stilling" /></SelectTrigger>
              <SelectContent>
                {positions.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

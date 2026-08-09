// Rask opprettelse av kunde direkte fra en e-post-henvendelse. Bevisst
// minimal: navn, e-post, telefon og kundeprofil (som styrer kundenummer og
// standard prisliste). Resten redigeres i Kunder-appen etterpå.
import { useEffect, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { useCustomerProfiles } from "@/kunder/hooks/useCustomerProfiles";

export default function QuickCreateCustomerDialog({
  open,
  onOpenChange,
  defaultName,
  defaultEmail,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultName?: string | null;
  defaultEmail?: string | null;
  onCreated: (customerId: string) => void;
}) {
  const { data: profiles } = useCustomerProfiles(NB_LEGAL_ENTITY_ID);
  const activeProfiles = (profiles ?? []).filter((p) => p.status === "active");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [profileId, setProfileId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName((defaultName ?? "").trim());
    setEmail((defaultEmail ?? "").trim());
    setPhone("");
    setProfileId(activeProfiles[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultName, defaultEmail, profiles]);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Navn er påkrevd");
      return;
    }
    if (!profileId) {
      toast.error("Velg kundeprofil");
      return;
    }
    setSaving(true);
    try {
      const profile = activeProfiles.find((p) => p.id === profileId);
      const { data: number, error: numErr } = await supabase.rpc(
        "next_customer_number",
        { p_legal_entity_id: NB_LEGAL_ENTITY_ID, p_profile_id: profileId },
      );
      if (numErr) throw numErr;

      const isPrivate = !!profile?.is_private_person_default;
      const { data, error } = await supabase
        .from("customers")
        .insert({
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          customer_profile_id: profileId,
          customer_number: String(number),
          display_name: name.trim(),
          customer_type: isPrivate ? "consumer" : "business",
          is_private_person: isPrivate,
          primary_contact_name: name.trim(),
          primary_contact_email: email.trim() || null,
          primary_contact_phone: phone.trim() || null,
          status: "active",
        } as never)
        .select("id, display_name, customer_number")
        .single();
      if (error) throw error;

      toast.success(
        `Kunde ${(data as { customer_number: string }).customer_number} opprettet`,
      );
      onOpenChange(false);
      onCreated((data as { id: string }).id);
    } catch (e) {
      toast.error("Kunne ikke opprette kunde", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Opprett ny kunde fra e-posten
          </DialogTitle>
          <DialogDescription>
            Kundenummer tildeles fra valgt profil. Detaljer kan fylles ut senere i
            Kunder-appen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qc-name">Navn *</Label>
            <Input id="qc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qc-email">E-post</Label>
            <Input
              id="qc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qc-phone">Telefon</Label>
            <Input id="qc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Kundeprofil *</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger>
                <SelectValue placeholder="Velg profil" />
              </SelectTrigger>
              <SelectContent>
                {activeProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Opprett kunde
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

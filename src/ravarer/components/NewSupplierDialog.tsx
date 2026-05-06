import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (supplierId: string) => void;
}

export function NewSupplierDialog({ open, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const { legalEntityId } = useRavarer();
  const [name, setName] = useState("");
  const [orgNumber, setOrgNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setName(""); setOrgNumber(""); setEmail(""); setPhone(""); setNotes(""); setErrors({});
  };

  const create = useMutation({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      if (!name.trim()) errs.name = "Navn er påkrevd";
      const orgClean = orgNumber.replace(/\s/g, "");
      if (orgClean && !/^\d{9}$/.test(orgClean)) errs.org = "Org.nr må være 9 siffer";
      if (Object.keys(errs).length) {
        setErrors(errs);
        throw new Error("Validering feilet");
      }
      if (orgClean) {
        const { data: existing } = await supabase
          .from("suppliers")
          .select("id")
          .eq("legal_entity_id", legalEntityId)
          .eq("org_number", orgClean)
          .maybeSingle();
        if (existing) {
          setErrors({ org: "En leverandør med dette org.nr finnes allerede" });
          throw new Error("Duplikat");
        }
      }
      const { data, error } = await supabase
        .from("suppliers")
        .insert({
          legal_entity_id: legalEntityId,
          name: name.trim(),
          org_number: orgClean || null,
          contact_email: email.trim() || null,
          contact_phone: phone.trim() || null,
          notes: notes.trim() || null,
          is_active: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Leverandør opprettet");
      reset();
      onOpenChange(false);
      onCreated?.(data.id);
    },
    onError: (e: any) => {
      if (e.message !== "Validering feilet" && e.message !== "Duplikat") {
        toast.error(`Kunne ikke opprette: ${e.message}`);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ny leverandør</DialogTitle>
          <DialogDescription>Opprett en ny leverandør for valgt selskap.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="name">Navn *</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
          </div>
          <div>
            <Label htmlFor="org">Org.nr</Label>
            <Input id="org" value={orgNumber} onChange={(e) => setOrgNumber(e.target.value)} placeholder="9 siffer" />
            {errors.org && <p className="mt-1 text-xs text-destructive">{errors.org}</p>}
          </div>
          <div>
            <Label htmlFor="email">Kontakt-epost</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="phone">Telefon</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="notes">Notater</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Opprett
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

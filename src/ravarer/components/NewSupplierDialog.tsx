import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cleanOrgNumber, orgNumberError } from "@/ravarer/lib/orgNumber";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (supplierId: string) => void;
  /** Sett for å redigere en eksisterende leverandør. */
  supplier?: SupplierRow | null;
}

/**
 * Én dialog for både ny og eksisterende leverandør. Tidligere fantes det en
 * forenklet kopi inne i leverandørfanen uten org.nr-kontroll — den er fjernet.
 */
export function SupplierDialog({ open, onOpenChange, onCreated, supplier = null }: Props) {
  const qc = useQueryClient();
  const { legalEntityId } = useRavarer();
  const isEdit = !!supplier;

  const [name, setName] = useState("");
  const [orgNumber, setOrgNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [trackInvoiceLines, setTrackInvoiceLines] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName(supplier?.name ?? "");
    setOrgNumber(supplier?.org_number ?? "");
    setEmail(supplier?.contact_email ?? "");
    setPhone(supplier?.contact_phone ?? "");
    setNotes(supplier?.notes ?? "");
    setIsActive(supplier?.is_active ?? true);
    setTrackInvoiceLines(!!supplier?.track_invoice_lines);
    setErrors({});
  }, [open, supplier]);

  const save = useMutation({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      if (!name.trim()) errs.name = "Navn er påkrevd";
      const orgClean = cleanOrgNumber(orgNumber);
      const orgErr = orgNumberError(orgClean);
      if (orgErr) errs.org = orgErr;
      if (Object.keys(errs).length) {
        setErrors(errs);
        throw new Error("Validering feilet");
      }

      if (orgClean) {
        let q = supabase
          .from("suppliers")
          .select("id")
          .eq("legal_entity_id", legalEntityId)
          .eq("org_number", orgClean);
        if (supplier) q = q.neq("id", supplier.id);
        const { data: existing } = await q.maybeSingle();
        if (existing) {
          setErrors({ org: "En leverandør med dette org.nr finnes allerede" });
          throw new Error("Duplikat");
        }
      }

      const payload = {
        name: name.trim(),
        org_number: orgClean || null,
        contact_email: email.trim() || null,
        contact_phone: phone.trim() || null,
        notes: notes.trim() || null,
        is_active: isActive,
        track_invoice_lines: trackInvoiceLines,
      };

      if (supplier) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", supplier.id);
        if (error) throw error;
        return { id: supplier.id };
      }
      const { data, error } = await supabase
        .from("suppliers")
        .insert({ ...payload, legal_entity_id: legalEntityId })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["supplier", data.id] });
      toast.success(isEdit ? "Leverandør lagret" : "Leverandør opprettet");
      onOpenChange(false);
      if (!isEdit) onCreated?.(data.id);
    },
    onError: (e: Error) => {
      if (e.message !== "Validering feilet" && e.message !== "Duplikat") {
        toast.error(`Kunne ikke lagre: ${e.message}`);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rediger leverandør" : "Ny leverandør"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Endre kontaktopplysninger og innstillinger for leverandøren."
              : "Opprett en ny leverandør for valgt selskap."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="sup-name">Navn *</Label>
            <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
          </div>
          <div>
            <Label htmlFor="sup-org">Org.nr</Label>
            <Input id="sup-org" value={orgNumber} onChange={(e) => setOrgNumber(e.target.value)} placeholder="9 siffer" />
            {errors.org && <p className="mt-1 text-xs text-destructive">{errors.org}</p>}
          </div>
          <div>
            <Label htmlFor="sup-email">Kontakt-epost</Label>
            <Input id="sup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sup-phone">Telefon</Label>
            <Input id="sup-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sup-notes">Notater</Label>
            <Textarea id="sup-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Aktiv</span>
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Aktiv leverandør" />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Følg fakturalinjer</span>
            <Switch
              checked={trackInvoiceLines}
              onCheckedChange={setTrackInvoiceLines}
              aria-label="Følg fakturalinjer"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {isEdit ? "Lagre" : "Opprett"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bakoverkompatibelt navn for opprettelse. */
export function NewSupplierDialog(props: Omit<Props, "supplier">) {
  return <SupplierDialog {...props} />;
}

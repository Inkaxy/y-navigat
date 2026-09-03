import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Building2, Plus, Pencil, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type LE = {
  id: string;
  short_code: string;
  legal_name: string;
  display_name: string | null;
  org_number: string;
  gln: string | null;
  gs1_prefix: string | null;
  invoice_address_line1: string | null;
  invoice_address_line2: string | null;
  invoice_postal_code: string | null;
  invoice_city: string | null;
  invoice_country: string;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  support_email: string | null;
  support_phone: string | null;
  bank_name: string | null;
  bank_account: string | null;
  iban: string | null;
  swift: string | null;
  status: string;
  created_at: string;
};

const empty: Partial<LE> = {
  short_code: "",
  legal_name: "",
  display_name: "",
  org_number: "",
  gln: "",
  gs1_prefix: "",
  invoice_address_line1: "",
  invoice_address_line2: "",
  invoice_postal_code: "",
  invoice_city: "",
  invoice_country: "NO",
  contact_person: "",
  contact_email: "",
  contact_phone: "",
  support_email: "",
  support_phone: "",
  bank_name: "",
  bank_account: "",
  iban: "",
  swift: "",
  status: "active",
};

export default function Selskaper() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<LE> | null>(null);
  const [deleting, setDeleting] = useState<LE | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-legal-entities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("*")
        .order("short_code");
      if (error) throw error;
      return data as LE[];
    },
  });

  const filtered = data.filter((r) => {
    const q = search.toLowerCase();
    return (
      !q ||
      r.legal_name.toLowerCase().includes(q) ||
      r.short_code.toLowerCase().includes(q)
    );
  });

  const save = useMutation({
    mutationFn: async (row: Partial<LE>) => {
      if (row.id) {
        const { id, created_at, ...patch } = row as any;
        const { error } = await supabase.from("legal_entities").update(patch).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("legal_entities").insert(row as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-legal-entities"] });
      toast.success("Lagret");
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Kunne ikke lagre"),
  });

  const toggleStatus = useMutation({
    mutationFn: async (row: LE) => {
      const next = row.status === "active" ? "inactive" : "active";
      const { error } = await supabase
        .from("legal_entities")
        .update({ status: next })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-legal-entities"] });
      toast.success("Status oppdatert");
    },
    onError: (e: any) => toast.error(e.message ?? "Feilet"),
  });

  const remove = useMutation({
    mutationFn: async (row: LE) => {
      const { error } = await supabase.from("legal_entities").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-legal-entities"] });
      toast.success("Selskap slettet");
      setDeleting(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Kunne ikke slette"),
  });

  return (
    <AdminLayout title="Selskaper">
      <AppHeaderBanner
        icon={Building2}
        title="Selskaper"
        subtitle="Juridisk enhet for bakeriet."
        actions={
          <Button size="sm" onClick={() => setEditing({ ...empty })}>
            <Plus className="h-4 w-4" /> Nytt selskap
          </Button>
        }
      />

      <div className="flex items-center gap-2">
        <Input
          placeholder="Søk på navn eller kode…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="rounded-md border border-line bg-surface-canvas">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Navn</TableHead>
              <TableHead>Org.nr</TableHead>
              <TableHead>Adresse</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Opprettet</TableHead>
              <TableHead className="text-right">Handling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Laster…</TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Ingen treff</TableCell></TableRow>
            )}
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.short_code}</TableCell>
                <TableCell className="font-medium">{r.legal_name}</TableCell>
                <TableCell>{r.org_number}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {[r.invoice_address_line1, r.invoice_postal_code, r.invoice_city].filter(Boolean).join(", ")}
                </TableCell>
                <TableCell>
                  <Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString("no-NO")}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleStatus.mutate(r)}>
                    {r.status === "active" ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Rediger selskap" : "Nytt selskap"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-5">
              <Section title="Identitet">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Kode" value={editing.short_code ?? ""} onChange={(v) => setEditing({ ...editing, short_code: v })} />
                  <Field label="Org.nr" value={editing.org_number ?? ""} onChange={(v) => setEditing({ ...editing, org_number: v })} />
                  <Field label="Juridisk navn" value={editing.legal_name ?? ""} onChange={(v) => setEditing({ ...editing, legal_name: v })} className="col-span-2" />
                  <Field label="Visningsnavn" value={editing.display_name ?? ""} onChange={(v) => setEditing({ ...editing, display_name: v })} className="col-span-2" />
                </div>
              </Section>

              <Section title="GS1">
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="GLN (GS1 lokasjonsnummer)"
                    value={editing.gln ?? ""}
                    onChange={(v) => setEditing({ ...editing, gln: v.replace(/\D/g, "") })}
                  />
                  <Field
                    label="GS1 leverandørnummer (prefiks)"
                    value={editing.gs1_prefix ?? ""}
                    onChange={(v) => setEditing({ ...editing, gs1_prefix: v.replace(/\D/g, "") })}
                  />
                </div>
              </Section>

              <Section title="Adresse">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Adresselinje 1" value={editing.invoice_address_line1 ?? ""} onChange={(v) => setEditing({ ...editing, invoice_address_line1: v })} className="col-span-2" />
                  <Field label="Adresselinje 2" value={editing.invoice_address_line2 ?? ""} onChange={(v) => setEditing({ ...editing, invoice_address_line2: v })} className="col-span-2" />
                  <Field label="Postnr" value={editing.invoice_postal_code ?? ""} onChange={(v) => setEditing({ ...editing, invoice_postal_code: v })} />
                  <Field label="Poststed" value={editing.invoice_city ?? ""} onChange={(v) => setEditing({ ...editing, invoice_city: v })} />
                  <Field label="Land" value={editing.invoice_country ?? "NO"} onChange={(v) => setEditing({ ...editing, invoice_country: v })} />
                </div>
              </Section>

              <Section title="Kontakt">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Kontaktperson" value={editing.contact_person ?? ""} onChange={(v) => setEditing({ ...editing, contact_person: v })} className="col-span-2" />
                  <Field label="E-postadresse" value={editing.contact_email ?? ""} onChange={(v) => setEditing({ ...editing, contact_email: v })} />
                  <Field label="Telefonnummer" value={editing.contact_phone ?? ""} onChange={(v) => setEditing({ ...editing, contact_phone: v })} />
                </div>
              </Section>

              <Section title="Brukerstøtte">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Brukerstøtte e-post" value={editing.support_email ?? ""} onChange={(v) => setEditing({ ...editing, support_email: v })} />
                  <Field label="Brukerstøtte telefon" value={editing.support_phone ?? ""} onChange={(v) => setEditing({ ...editing, support_phone: v })} />
                </div>
              </Section>

              <Section title="Bank">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Banknavn" value={editing.bank_name ?? ""} onChange={(v) => setEditing({ ...editing, bank_name: v })} className="col-span-2" />
                  <Field label="Kontonummer" value={editing.bank_account ?? ""} onChange={(v) => setEditing({ ...editing, bank_account: v })} />
                  <Field label="BIC/SWIFT" value={editing.swift ?? ""} onChange={(v) => setEditing({ ...editing, swift: v })} />
                  <Field label="IBAN" value={editing.iban ?? ""} onChange={(v) => setEditing({ ...editing, iban: v })} className="col-span-2" />
                </div>
              </Section>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Avbryt</Button>
            <Button onClick={() => editing && save.mutate(editing)} disabled={save.isPending}>Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette selskap?</AlertDialogTitle>
            <AlertDialogDescription>
              Er du sikker på at du vil slette <strong>{deleting?.legal_name}</strong>? Dette kan feile dersom selskapet har tilknyttede outlets, kunder eller andre data. Handlingen kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); deleting && remove.mutate(deleting); }}
              disabled={remove.isPending}
            >
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}

function Field({ label, value, onChange, className }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  );
}

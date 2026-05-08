import { useState } from "react";
import { Plus, Pencil, Trash2, Star, Loader2, Mail, Phone, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useCustomerContacts,
  useCreateCustomerContact,
  useUpdateCustomerContact,
  useDeleteCustomerContact,
  type CustomerContact,
  type CustomerContactInput,
} from "@/kunder/hooks/useCustomerContacts";

type Props = {
  customerId: string;
  canWrite: boolean;
};

const EMPTY: CustomerContactInput = {
  name: "",
  role: "",
  email: "",
  phone: "",
  mobile: "",
  notes: "",
  is_primary: false,
};

export function CustomerContactsCard({ customerId, canWrite }: Props) {
  const { data: contacts, isLoading } = useCustomerContacts(customerId);
  const createMut = useCreateCustomerContact(customerId);
  const updateMut = useUpdateCustomerContact(customerId);
  const deleteMut = useDeleteCustomerContact(customerId);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerContact | null>(null);
  const [draft, setDraft] = useState<CustomerContactInput>(EMPTY);
  const [confirmDelete, setConfirmDelete] = useState<CustomerContact | null>(null);

  const openNew = () => {
    setEditing(null);
    setDraft(EMPTY);
    setEditorOpen(true);
  };

  const openEdit = (c: CustomerContact) => {
    setEditing(c);
    setDraft({
      name: c.name,
      role: c.role ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      mobile: c.mobile ?? "",
      notes: c.notes ?? "",
      is_primary: c.is_primary,
    });
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (!draft.name.trim()) {
      toast.error("Navn er påkrevd");
      return;
    }
    try {
      const payload: CustomerContactInput = {
        name: draft.name.trim(),
        role: draft.role?.trim() || null,
        email: draft.email?.trim() || null,
        phone: draft.phone?.trim() || null,
        mobile: draft.mobile?.trim() || null,
        notes: draft.notes?.trim() || null,
        is_primary: !!draft.is_primary,
      };
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, patch: payload });
        toast.success("Kontakt oppdatert");
      } else {
        await createMut.mutateAsync(payload);
        toast.success("Kontakt lagt til");
      }
      setEditorOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke lagre");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteMut.mutateAsync(confirmDelete.id);
      toast.success("Kontakt fjernet");
      setConfirmDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke slette");
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Flere kontaktpersoner</CardTitle>
            <CardDescription>
              Tilleggskontakter for denne kunden (i tillegg til hovedkontakt)
            </CardDescription>
          </div>
          {canWrite && (
            <Button type="button" size="sm" variant="outline" onClick={openNew}>
              <Plus className="mr-1.5 h-4 w-4" />
              Ny kontakt
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Laster …
            </div>
          ) : !contacts || contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ingen ekstra kontaktpersoner ennå.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {contacts.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {c.role && (
                        <span className="text-sm text-muted-foreground">
                          — {c.role}
                        </span>
                      )}
                      {c.is_primary && (
                        <Badge variant="secondary" className="gap-1">
                          <Star className="h-3 w-3" /> Primær
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {c.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {c.email}
                        </span>
                      )}
                      {c.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {c.phone}
                        </span>
                      )}
                      {c.mobile && (
                        <span className="inline-flex items-center gap-1">
                          <Smartphone className="h-3 w-3" />
                          {c.mobile}
                        </span>
                      )}
                    </div>
                    {c.notes && (
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground/90">
                        {c.notes}
                      </p>
                    )}
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(c)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setConfirmDelete(c)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Rediger kontakt" : "Ny kontakt"}</DialogTitle>
            <DialogDescription>
              Fyll inn kontaktinformasjonen. Kun navn er påkrevd.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Navn *</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>Rolle / tittel</Label>
                <Input
                  value={draft.role ?? ""}
                  placeholder="f.eks. Daglig leder"
                  onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>E-post</Label>
              <Input
                type="email"
                value={draft.email ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Telefon</Label>
                <Input
                  value={draft.phone ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Mobil</Label>
                <Input
                  value={draft.mobile ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, mobile: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notat</Label>
              <Textarea
                rows={2}
                value={draft.notes ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={!!draft.is_primary}
                onCheckedChange={(v) =>
                  setDraft((d) => ({ ...d, is_primary: !!v }))
                }
              />
              Marker som primær kontakt
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {(createMut.isPending || updateMut.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Lagre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette kontakt?</AlertDialogTitle>
            <AlertDialogDescription>
              Vil du fjerne <span className="font-medium">{confirmDelete?.name}</span>{" "}
              fra kontaktlista? Dette kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppBanner } from "@/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type PickupLocation,
  useDeletePickupLocation,
  usePickupLocations,
  usePickupLocationUsage,
  useUpsertPickupLocation,
} from "@/hooks/usePickupLocations";
import { useUserAccess } from "@/hooks/useUserAccess";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedEntity, ALL_ENTITIES } from "@/state/SelectedEntityContext";
import { SettingsSubMenu } from "@/components/shell/SettingsSubMenu";

export default function PickupLocations() {
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const canWrite = !!access?.hasKunderWrite;
  const { selected, setSelected, isAll } = useSelectedEntity();
  const entities = access?.entities ?? [];

  // For denne admin-siden krever vi et konkret selskap valgt
  const effectiveEntityId =
    !isAll && selected ? selected : entities[0]?.id ?? null;

  const { data: locations, isLoading } = usePickupLocations(effectiveEntityId);
  const { data: usage } = usePickupLocationUsage(effectiveEntityId);
  const upsert = useUpsertPickupLocation();
  const del = useDeletePickupLocation();

  const [editing, setEditing] = useState<PickupLocation | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PickupLocation | null>(null);

  const nextNumber = useMemo(() => {
    if (!locations || locations.length === 0) return 1;
    return Math.max(...locations.map((l) => l.pickup_number)) + 1;
  }, [locations]);

  return (
    <>
      <AppBanner
        title="Hentesteder"
        subtitle="Lokasjoner kunder kan hente varer på (alternativ til levering)"
      />
      <SettingsSubMenu />
      <div className="container py-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-medium text-muted-foreground">Selskap</Label>
            <Select
              value={isAll ? ALL_ENTITIES : selected ?? ""}
              onValueChange={(v) => setSelected(v)}
            >
              <SelectTrigger className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.legal_name} ({e.short_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canWrite && effectiveEntityId && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="mr-2 h-4 w-4" /> Nytt hentested
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Hentesteder</CardTitle>
            <CardDescription>
              Hentesteder brukes til pakking, ordre og kundens utkjøring-innstillinger.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !effectiveEntityId ? (
              <p className="text-sm text-muted-foreground">Velg et selskap.</p>
            ) : (locations ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ingen hentesteder enda. Klikk "Nytt hentested" for å opprette.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Nr</TableHead>
                    <TableHead>Navn</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead className="w-32">Antall kunder</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-32 text-right">Handlinger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(locations ?? []).map((loc) => {
                    const count = usage?.[loc.id] ?? 0;
                    return (
                      <TableRow key={loc.id}>
                        <TableCell className="font-mono">{loc.pickup_number}</TableCell>
                        <TableCell className="font-medium">{loc.display_name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {loc.city ?? "—"}
                        </TableCell>
                        <TableCell>{count}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              loc.status === "active"
                                ? "border-success/30 bg-success/10 text-success"
                                : "border-border bg-muted text-muted-foreground"
                            }
                          >
                            {loc.status === "active" ? "Aktiv" : "Inaktiv"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {canWrite && (
                            <div className="inline-flex gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setEditing(loc)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/5"
                                onClick={() => setConfirmDelete(loc)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {editing && effectiveEntityId && (
        <PickupDialog
          open
          legalEntityId={effectiveEntityId}
          initial={editing === "new" ? null : editing}
          defaultNumber={nextNumber}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            try {
              await upsert.mutateAsync(values);
              toast.success(editing === "new" ? "Hentested opprettet" : "Lagret");
              setEditing(null);
            } catch (e: any) {
              toast.error(`Kunne ikke lagre: ${e?.message ?? "Ukjent feil"}`);
            }
          }}
        />
      )}

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette hentested?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (usage?.[confirmDelete.id] ?? 0) > 0
                ? `Dette hentestedet brukes av ${usage?.[confirmDelete.id] ?? 0} kunde(r) og kan ikke slettes. Det vil bli deaktivert i stedet.`
                : `Hentestedet "${confirmDelete?.display_name}" vil bli slettet permanent.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDelete) return;
                try {
                  const res = await del.mutateAsync({
                    id: confirmDelete.id,
                    legal_entity_id: confirmDelete.legal_entity_id,
                    usageCount: usage?.[confirmDelete.id] ?? 0,
                    display_name: confirmDelete.display_name,
                    pickup_number: confirmDelete.pickup_number,
                  });
                  toast.success(res.deactivated ? "Deaktivert" : "Slettet");
                  setConfirmDelete(null);
                } catch (e: any) {
                  toast.error(`Feil: ${e?.message ?? "Ukjent"}`);
                }
              }}
            >
              Bekreft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PickupDialog({
  open,
  legalEntityId,
  initial,
  defaultNumber,
  onClose,
  onSave,
}: {
  open: boolean;
  legalEntityId: string;
  initial: PickupLocation | null;
  defaultNumber: number;
  onClose: () => void;
  onSave: (v: any) => Promise<void>;
}) {
  const [pickupNumber, setPickupNumber] = useState<number>(
    initial?.pickup_number ?? defaultNumber,
  );
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [addr1, setAddr1] = useState(initial?.address_line_1 ?? "");
  const [addr2, setAddr2] = useState(initial?.address_line_2 ?? "");
  const [postal, setPostal] = useState(initial?.postal_code ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [active, setActive] = useState((initial?.status ?? "active") === "active");
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Rediger hentested" : "Nytt hentested"}</DialogTitle>
          <DialogDescription>
            Hentesteder er masterdata for kunder som henter varer i stedet for levering.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nr</Label>
              <Input
                type="number"
                min={1}
                max={99}
                value={pickupNumber}
                onChange={(e) => setPickupNumber(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Navn *</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="F.eks. Teie"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Beskrivelse</Label>
            <Textarea
              rows={2}
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Adresselinje 1</Label>
            <Input value={addr1 ?? ""} onChange={(e) => setAddr1(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Adresselinje 2</Label>
            <Input value={addr2 ?? ""} onChange={(e) => setAddr2(e.target.value)} />
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Postnr</Label>
              <Input value={postal ?? ""} onChange={(e) => setPostal(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sted</Label>
              <Input value={city ?? ""} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-input p-3">
            <Switch checked={active} onCheckedChange={setActive} />
            <span className="text-sm">{active ? "Aktiv" : "Inaktiv"}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button
            disabled={saving || !displayName.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  id: initial?.id,
                  legal_entity_id: legalEntityId,
                  pickup_number: pickupNumber,
                  display_name: displayName.trim(),
                  description: description?.trim() || null,
                  address_line_1: addr1?.trim() || null,
                  address_line_2: addr2?.trim() || null,
                  postal_code: postal?.trim() || null,
                  city: city?.trim() || null,
                  status: active ? "active" : "inactive",
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { useLabelPrintProfiles } from "@/produksjon/features/utskriftsprofiler/hooks/useLabelPrintProfiles";
import { useUpdateProductLabelProfile } from "../hooks/useProductLabelProfiles";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productId: string | null;
  productName: string;
  legalEntityId: string;
  currentProfileId: string | null;
}

const lastProfileKey = (entityId: string) =>
  `nbos_produksjon_last_profile_${entityId}`;

export function VelgProfilForVareDialog({
  open,
  onOpenChange,
  productId,
  productName,
  legalEntityId,
  currentProfileId,
}: Props) {
  const { data: profiles, isLoading } = useLabelPrintProfiles(
    legalEntityId || undefined,
  );
  const update = useUpdateProductLabelProfile();
  const [selectedId, setSelectedId] = useState<string>("");

  const activeProfiles = useMemo(
    () => (profiles ?? []).filter((p) => p.status === "active"),
    [profiles],
  );

  // Sett default ved åpning
  useEffect(() => {
    if (!open) return;
    if (currentProfileId && activeProfiles.some((p) => p.id === currentProfileId)) {
      setSelectedId(currentProfileId);
      return;
    }
    const last =
      typeof window !== "undefined"
        ? window.localStorage.getItem(lastProfileKey(legalEntityId))
        : null;
    if (last && activeProfiles.some((p) => p.id === last)) {
      setSelectedId(last);
      return;
    }
    setSelectedId(activeProfiles[0]?.id ?? "");
  }, [open, currentProfileId, legalEntityId, activeProfiles]);

  const handleSave = async () => {
    if (!productId || !selectedId) return;
    try {
      await update.mutateAsync({
        productId,
        profileId: selectedId,
        productLegalEntityId: legalEntityId,
      });
      const profile = activeProfiles.find((p) => p.id === selectedId);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(lastProfileKey(legalEntityId), selectedId);
      }
      toast.success(
        `Profil "${profile?.name ?? ""}" satt for ${productName}.`,
      );
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Kunne ikke lagre profil";
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Etikett-profil for varen</DialogTitle>
          <DialogDescription>{productName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label htmlFor="profile-select">Profil</Label>
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : activeProfiles.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Ingen aktive profiler for dette selskapet.
            </div>
          ) : (
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger id="profile-select">
                <SelectValue placeholder="Velg profil" />
              </SelectTrigger>
              <SelectContent>
                {activeProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <a
            href="/produksjon/innstillinger/utskriftsprofiler"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Opprett ny profil
          </a>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            onClick={handleSave}
            disabled={!selectedId || update.isPending}
            className="gap-2"
          >
            {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

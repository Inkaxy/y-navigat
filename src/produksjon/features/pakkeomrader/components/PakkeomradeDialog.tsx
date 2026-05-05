import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCreatePackingArea,
  useUpdatePackingArea,
  DuplicatePackingAreaCodeError,
} from "../hooks/usePackingAreaMutations";
import { usePackingAreaUsage } from "../hooks/usePackingAreas";
import type { PackingArea } from "../types";
import type { LegalEntityOption } from "@/features/produksjonsavdelinger/hooks/useLegalEntities";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  legalEntity: LegalEntityOption | null;
  existing?: PackingArea | null;
  suggestedDisplayOrder: number;
}

const CODE_PATTERN = /^[A-Z0-9_]{1,10}$/;

export function PakkeomradeDialog({
  open,
  onOpenChange,
  mode,
  legalEntity,
  existing,
  suggestedDisplayOrder,
}: Props) {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [displayOrder, setDisplayOrder] = useState(10);
  const [notes, setNotes] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const createMut = useCreatePackingArea();
  const updateMut = useUpdatePackingArea();

  // Når vi redigerer: sjekk om koden er låst (brukes i product_packing_areas).
  const usageQuery = usePackingAreaUsage(
    mode === "edit" && existing ? existing.id : undefined,
  );
  const usageCount = usageQuery.data ?? 0;
  const codeLocked = mode === "edit" && usageCount > 0;

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && existing) {
      setCode(existing.code);
      setDisplayName(existing.display_name);
      setDisplayOrder(existing.display_order);
      setNotes(existing.notes ?? "");
    } else {
      setCode("");
      setDisplayName("");
      setDisplayOrder(suggestedDisplayOrder);
      setNotes("");
    }
    setCodeError(null);
    setNameError(null);
  }, [open, mode, existing, suggestedDisplayOrder]);

  const isSubmitting = createMut.isPending || updateMut.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError(null);
    setNameError(null);

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setNameError("Navn er påkrevd.");
      return;
    }
    if (trimmedName.length > 60) {
      setNameError("Maks 60 tegn.");
      return;
    }

    const upperCode = code.trim().toUpperCase();
    if (!CODE_PATTERN.test(upperCode)) {
      setCodeError("Koden må være 1–10 tegn med kun A–Z, 0–9 eller _.");
      return;
    }

    const trimmedNotes = notes.trim();

    if (mode === "create") {
      if (!legalEntity) {
        toast.error("Velg et selskap først.");
        return;
      }
      try {
        await createMut.mutateAsync({
          legal_entity_id: legalEntity.id,
          code: upperCode,
          display_name: trimmedName,
          display_order: displayOrder,
          notes: trimmedNotes ? trimmedNotes : null,
        });
        toast.success(`Pakkeområdet "${trimmedName}" er opprettet.`);
        onOpenChange(false);
      } catch (err) {
        if (err instanceof DuplicatePackingAreaCodeError) {
          toast.error(
            `Koden "${err.code}" finnes allerede i ${legalEntity.legal_name}.`,
          );
          setCodeError("Velg en annen kode.");
        } else {
          const msg = err instanceof Error ? err.message : "Ukjent feil";
          toast.error(`Kunne ikke opprette pakkeområde: ${msg}`);
        }
      }
    } else {
      if (!existing) return;
      try {
        await updateMut.mutateAsync({
          id: existing.id,
          display_name: trimmedName,
          display_order: displayOrder,
          notes: trimmedNotes ? trimmedNotes : null,
          code: codeLocked ? undefined : upperCode,
        });
        toast.success("Endringene er lagret.");
        onOpenChange(false);
      } catch (err) {
        if (err instanceof DuplicatePackingAreaCodeError) {
          toast.error(`Koden "${err.code}" finnes allerede i dette selskapet.`);
          setCodeError("Velg en annen kode.");
        } else {
          const msg = err instanceof Error ? err.message : "Ukjent feil";
          toast.error(`Kunne ikke lagre endringer: ${msg}`);
        }
      }
    }
  };

  const entityLabel =
    mode === "edit" && existing
      ? legalEntity?.legal_name ?? existing.legal_entity_id
      : legalEntity?.legal_name ?? "Velg selskap";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "Nytt pakkeområde" : "Rediger pakkeområde"}
            </DialogTitle>
            <DialogDescription>
              Pakkeområder brukes når produkter pakkes for utsendelse.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Selskap</Label>
              <p className="text-sm font-medium">{entityLabel}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pa-code">Kode</Label>
              {codeLocked ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="block">
                        <Input
                          id="pa-code"
                          value={code}
                          disabled
                          aria-invalid={!!codeError}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Kan ikke endres — brukes av {usageCount}{" "}
                      {usageCount === 1 ? "produkt" : "produkter"}.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <Input
                  id="pa-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="POSE"
                  maxLength={10}
                  aria-invalid={!!codeError}
                />
              )}
              {codeError ? (
                <p className="text-xs text-destructive">{codeError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Brukes i systemet og i etikett-nummer senere. Eks: LOS, POSE, BRETT.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pa-display-name">Navn</Label>
              <Input
                id="pa-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Plastpose 500g"
                maxLength={60}
                aria-invalid={!!nameError}
              />
              {nameError ? (
                <p className="text-xs text-destructive">{nameError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Vises i pakkelisten.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pa-display-order">Rekkefølge</Label>
              <Input
                id="pa-display-order"
                type="number"
                step={10}
                value={displayOrder}
                onChange={(e) => setDisplayOrder(Number(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                Lavest vises først. La stå for standard.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pa-notes">Notater</Label>
              <Textarea
                id="pa-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Valgfri notat — synlig kun i innstillinger."
                rows={3}
                maxLength={500}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Avbryt
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Lagrer …" : mode === "create" ? "Opprett" : "Lagre"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

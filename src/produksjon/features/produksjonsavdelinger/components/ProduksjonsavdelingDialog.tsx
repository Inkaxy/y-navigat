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
import { Switch } from "@/components/ui/switch";
import {
  useCreateProductionDepartment,
  useUpdateProductionDepartment,
  DuplicateCodeError,
} from "../hooks/useProductionDepartmentMutations";
import type { ProductionDepartment } from "../types";
import type { LegalEntityOption } from "../hooks/useLegalEntities";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  legalEntity: LegalEntityOption | null;
  existing?: ProductionDepartment | null;
  suggestedSortOrder: number;
}

const CODE_PATTERN = /^[A-Z0-9_]{2,20}$/;

export function ProduksjonsavdelingDialog({
  open,
  onOpenChange,
  mode,
  legalEntity,
  existing,
  suggestedSortOrder,
}: Props) {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sortOrder, setSortOrder] = useState(100);
  const [active, setActive] = useState(true);
  const [alertEmail, setAlertEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const createMut = useCreateProductionDepartment();
  const updateMut = useUpdateProductionDepartment();

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && existing) {
      setCode(existing.code);
      setDisplayName(existing.display_name);
      setSortOrder(existing.sort_order);
      setActive(existing.status === "active");
      setAlertEmail(existing.low_stock_alert_email ?? "");
    } else {
      setCode("");
      setDisplayName("");
      setSortOrder(suggestedSortOrder);
      setActive(true);
      setAlertEmail("");
    }
    setEmailError(null);
    setCodeError(null);
    setNameError(null);
  }, [open, mode, existing, suggestedSortOrder]);

  const isSubmitting = createMut.isPending || updateMut.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError(null);
    setNameError(null);
    setEmailError(null);

    const trimmedEmail = alertEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError("Skriv en gyldig e-postadresse.");
      return;
    }

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setNameError("Navn er påkrevd.");
      return;
    }
    if (trimmedName.length > 80) {
      setNameError("Maks 80 tegn.");
      return;
    }

    if (mode === "create") {
      if (!legalEntity) {
        toast.error("Velg et selskap først.");
        return;
      }
      const upperCode = code.trim().toUpperCase();
      if (!CODE_PATTERN.test(upperCode)) {
        setCodeError("Koden må være 2–20 tegn med kun A–Z, 0–9 eller _.");
        return;
      }

      try {
        await createMut.mutateAsync({
          legal_entity_id: legalEntity.id,
          code: upperCode,
          display_name: trimmedName,
          sort_order: sortOrder,
          status: active ? "active" : "inactive",
          low_stock_alert_email: trimmedEmail || null,
        });
        toast.success("Avdelingen er opprettet.");
        onOpenChange(false);
      } catch (err) {
        if (err instanceof DuplicateCodeError) {
          toast.error(
            `Koden "${err.code}" er allerede i bruk i ${legalEntity.legal_name}.`,
          );
          setCodeError("Velg en annen kode.");
        } else {
          const msg = err instanceof Error ? err.message : "Ukjent feil";
          toast.error(`Kunne ikke opprette avdeling: ${msg}`);
        }
      }
    } else {
      if (!existing) return;
      try {
        await updateMut.mutateAsync({
          id: existing.id,
          display_name: trimmedName,
          sort_order: sortOrder,
          status: active ? "active" : "inactive",
          low_stock_alert_email: trimmedEmail || null,
        });
        toast.success("Endringene er lagret.");
        onOpenChange(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Ukjent feil";
        toast.error(`Kunne ikke lagre endringer: ${msg}`);
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
              {mode === "create" ? "Ny produksjonsavdeling" : "Rediger avdeling"}
            </DialogTitle>
            <DialogDescription>
              Avdelinger styrer hvilke etiketter som skrives ut hvor.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Selskap</Label>
              <p className="text-sm font-medium">{entityLabel}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="code">Kode</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="KAKE"
                maxLength={20}
                disabled={mode === "edit"}
                aria-invalid={!!codeError}
              />
              {codeError ? (
                <p className="text-xs text-destructive">{codeError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  2–20 tegn. Kun store bokstaver, tall eller _. Kan ikke endres senere.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="display_name">Navn</Label>
              <Input
                id="display_name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Kakebord"
                maxLength={80}
                aria-invalid={!!nameError}
              />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sort_order">Sortering</Label>
              <Input
                id="sort_order"
                type="number"
                step={10}
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                Lavere tall vises først.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="low_stock_alert_email">Varsel-e-post ved lavt lager</Label>
              <Input
                id="low_stock_alert_email"
                type="email"
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                placeholder="produksjon@bakeri.no"
                aria-invalid={!!emailError}
              />
              {emailError ? (
                <p className="text-xs text-destructive">{emailError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Daglig sammendrag kl. 05:30 med lagervarer under min-nivå. La stå tomt for ingen varsling.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label htmlFor="status" className="text-sm">
                  Status
                </Label>
                <p className="text-xs text-muted-foreground">
                  {active ? "Aktiv" : "Inaktiv"}
                </p>
              </div>
              <Switch id="status" checked={active} onCheckedChange={setActive} />
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

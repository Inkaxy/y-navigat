import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { showError } from "@/lib/userError";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { clearStartPrice, startPriceIsStale, startPriceToAgreement } from "@/fakturaer/lib/startPrice";
import { formatNok, formatDate } from "@/fakturaer/lib/constants";
import type { RmSupplierRow } from "@/ravarer/hooks/useRmSuppliers";

/**
 * Startpriser på varekortet.
 *
 * Startprisen er den første bekreftede kjøpsprisen hos en leverandør, og den
 * står fast. Her ser man den der prisene ellers vises — ikke bare i
 * fakturakøen — og kan fjerne den eller gjøre den om til avtalepris.
 * Begge deler krever godkjennerrettighet og en begrunnelse, og serveren
 * håndhever det uansett hva skjermbildet viser.
 */
export function StartPriceCard({
  links,
  supplierNames,
  currentBaseUnit,
}: {
  links: RmSupplierRow[];
  supplierNames: Map<string, string>;
  currentBaseUnit: string | null;
}) {
  const qc = useQueryClient();
  const { accessLevel } = useRavarer();
  const canApprove = accessLevel === "approve" || accessLevel === "admin";

  const [dialog, setDialog] = useState<{ mode: "clear" | "agreement"; link: RmSupplierRow } | null>(null);
  const [reason, setReason] = useState("");
  /** Erstatning av en eksisterende avtalepris krever en uttrykkelig bekreftelse. */
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);

  const withStartPrice = links.filter((l) => l.start_price_per_base_unit != null);
  if (withStartPrice.length === 0) return null;

  async function run() {
    if (!dialog) return;
    setBusy(true);
    try {
      if (dialog.mode === "clear") {
        const res = await clearStartPrice(dialog.link.id, reason);
        toast.success(res.cleared ? "Startprisen er fjernet" : "Det finnes ingen startpris å fjerne");
      } else {
        const l = dialog.link;
        const res = await startPriceToAgreement({
          rmsId: l.id,
          reason,
          // Verdiene brukeren faktisk så. Er noe endret i mellomtiden, avviser
          // serveren handlingen i stedet for å erstatte avtaleprisen på feil grunnlag.
          expectedStartPrice: l.start_price_per_base_unit ?? null,
          expectedUnitChangeAt: l.start_price_unit_change_at ?? null,
          expectedPackageSize: l.package_size,
          expectedPackageUnit: l.package_unit,
          expectedBaseUnitsPerPackage: l.base_units_per_package,
          replaceExisting: l.agreed_price_per_base_unit != null,
        });
        toast.success("Startprisen er satt som avtalepris", {
          description: `Avtalen gjelder fra ${formatDate(res.validFrom)}. Eldre fakturaer påvirkes ikke.`,
        });
      }
      void qc.invalidateQueries({ queryKey: ["raw_material_suppliers", dialog.link.raw_material_id] });
      setDialog(null);
      setReason("");
    } catch (e: unknown) {
      showError("startpris", e, "Handlingen kunne ikke utføres");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="text-base font-semibold">Startpriser</h3>
        <p className="text-xs text-ink-secondary">
          Første bekreftede kjøpspris hos leverandøren. Den står fast og flyttes ikke av senere kjøp. En gyldig
          avtalepris går alltid foran startprisen.
        </p>
      </div>

      <ul className="space-y-3">
        {withStartPrice.map((l) => {
          const stale = startPriceIsStale({
            startPriceBaseUnit: l.start_price_base_unit ?? null,
            currentBaseUnit,
            startPrice: l.start_price_per_base_unit ?? null,
          });
          return (
            <li key={l.id} className="rounded-lg border border-line-subtle p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {supplierNames.get(l.supplier_id) ?? "Ukjent leverandør"}
                    <Badge variant="outline">Startpris</Badge>
                    {l.agreed_price_per_base_unit != null && <Badge variant="secondary">Avtalepris gjelder</Badge>}
                    {stale && <Badge variant="destructive">Grunnenheten er endret</Badge>}
                  </div>
                  <div className="mt-1 text-sm tabular-nums">
                    {formatNok(Number(l.start_price_per_base_unit))} per {l.start_price_base_unit ?? "enhet"}
                    {l.start_price_currency && l.start_price_currency !== "NOK" ? ` (${l.start_price_currency})` : ""}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-secondary">
                    Bekreftet {formatDate(l.start_price_confirmed_at ?? null)} • gjelder fra{" "}
                    {formatDate(l.start_price_effective_date ?? null)}
                    {l.start_price_package_size != null
                      ? ` • pakning ${l.start_price_package_size} ${l.start_price_package_unit ?? ""}`.trimEnd()
                      : ""}
                  </div>
                  {stale && (
                    <p className="mt-1 text-xs text-destructive">
                      Grunnenheten på varen er endret etter at startprisen ble bekreftet. Startprisen brukes ikke som
                      prisgrunnlag før den er bekreftet på nytt.
                    </p>
                  )}
                </div>
                {canApprove && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={stale}
                      onClick={() => {
                        setReason("");
                        setConfirmReplace(false);
                        setDialog({ mode: "agreement", link: l });
                      }}
                    >
                      Sett som avtalepris
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setReason("");
                        setConfirmReplace(false);
                        setDialog({ mode: "clear", link: l });
                      }}
                    >
                      Fjern startpris
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog open={!!dialog} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "clear" ? "Fjern startpris" : "Sett startpris som avtalepris"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === "clear"
                ? "Startprisen fjernes og kan bekreftes på nytt fra en fakturalinje senere."
                : dialog?.link.agreed_price_per_base_unit != null
                  ? "Leverandøren har allerede en avtalepris. Den blir erstattet av startprisen, og avtalen gjelder fra i dag."
                  : "Startprisen blir avtalepris og gjelder fra i dag. Eldre fakturaer påvirkes ikke."}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="startpris-begrunnelse">Begrunnelse</Label>
            <Textarea
              id="startpris-begrunnelse"
              className="mt-1"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Hvorfor gjør du denne endringen?"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
              Avbryt
            </Button>
            <Button onClick={run} disabled={busy || reason.trim().length === 0}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {dialog?.mode === "clear" ? "Fjern startpris" : "Sett som avtalepris"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Printer, Download, Ruler, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { markPrinted } from "@/ordre/lib/cakeImages";
import { cakePdfPreviewUrl, cakeSheetsToPdf } from "@/ordre/lib/cakePrint";
import { loadCakePrintItems } from "@/ordre/lib/cakePrintJob";
import { evaluatePrintGate } from "@/ordre/lib/cakePrintGate";
import { useCakePrinterSelection } from "@/ordre/hooks/useCakeCalibration";
import { useCakePrintFlow } from "@/ordre/hooks/useCakePrintFlow";
import { CalibratePrinterDialog } from "@/ordre/components/cake-images/CalibratePrinterDialog";
import { Button } from "@/components/ui/button";

/**
 * Utskriftsrute for kakebilder — én felles vei til papiret.
 * URL: /ordre/kakebilder/print?ids=a,b,c
 *
 * Forhåndsvisningen er selve PDF-en, ikke en HTML-kopi: det du ser er det
 * skriveren får. Status settes først når du har bekreftet at arket ble bra.
 */
export default function CakeImagesPrint() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ids = useMemo(
    () => (params.get("ids") || "").split(",").filter(Boolean),
    [params],
  );
  const {
    calibrations,
    printerLabel,
    selectPrinter,
    scaleX,
    scaleY,
    scaleXPct,
    scaleYPct,
    isCalibrated,
  } = useCakePrinterSelection();
  const scale = scaleX;
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

  const job = useQuery({
    queryKey: ["cake-print-items", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: () => loadCakePrintItems(ids),
  });
  const items = useMemo(() => job.data?.items ?? [], [job.data]);
  const statusById = useMemo(
    () => Object.fromEntries((job.data?.images ?? []).map((i) => [i.id, i.status])),
    [job.data],
  );

  const flow = useCakePrintFlow({
    scale,
    scaleY,
    printerLabel,
    scaleAppliedPct: scaleXPct,
  });

  // Forhåndsvisning: samme PDF som papiret.
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    if (items.length === 0) {
      setPreviewUrl(null);
      return;
    }
    void (async () => {
      try {
        const res = await cakePdfPreviewUrl(items, { scale, scaleY, printerLabel });
        if (cancelled) {
          URL.revokeObjectURL(res.url);
          return;
        }
        created = res.url;
        setPreviewUrl(res.url);
        setSkipped(
          res.skipped.map(
            (s) => `${s.item.labelNumber ?? s.item.title ?? "Uten navn"} — ${s.reason}`,
          ),
        );
      } catch (e) {
        console.error("[CakeImagesPrint] kunne ikke lage forhåndsvisning", e);
        toast.error("Kunne ikke lage forhåndsvisning av arkene");
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [items, scale, scaleY, printerLabel]);

  /** Sperren fra editoren gjelder også her — ingen ark uten format/rettigheter. */
  const printChecked = () => {
    const imageById = new Map((job.data?.images ?? []).map((i) => [i.id, i]));
    const blocked: string[] = [];
    const allowed = items.filter((item) => {
      const img = item.image ? imageById.get(item.image.id) : null;
      if (!img) return true;
      const gate = evaluatePrintGate(img);
      if (gate.ok) return true;
      blocked.push(`${item.labelNumber ?? item.title ?? "Uten navn"} — ${gate.reason}`);
      return false;
    });
    if (blocked.length > 0) {
      toast.warning(`${blocked.length} bilde(r) kan ikke skrives ut`, {
        description: blocked.join(" · "),
      });
    }
    if (allowed.length === 0) return;
    void flow.printItems(allowed, statusById);
  };

  const downloadPdf = async () => {
    if (items.length === 0) return;
    const res = await cakeSheetsToPdf(items, {
      scale,
      scaleY,
      printerLabel,
      fileName: "kakebilder.pdf",
    });
    // PDF er ikke papir: logges, men flytter ikke status.
    const printedIds = items
      .map((i) => i.image?.id)
      .filter(
        (id): id is string => !!id && !res.skipped.some((s) => s.item.image?.id === id),
      );
    if (printedIds.length > 0) {
      await markPrinted(printedIds, "pdf", res.sheet, null, {
        printerLabel,
        scaleAppliedPct: scaleXPct,
      });
    }
    toast.success("PDF lastet ned (status er uendret)");
  };

  if (job.isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          Tilbake
        </Button>
        <div className="ml-2 text-sm font-semibold">
          {items.length} kakebilde(r) — faktisk størrelse
        </div>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={printerLabel ?? ""}
          onChange={(e) => selectPrinter(e.target.value || null)}
          aria-label="Skriver"
        >
          <option value="">Velg skriver…</option>
          {calibrations.map((c) => (
            <option key={c.id} value={c.printer_label}>
              {c.printer_label}
              {c.is_default ? " (standard)" : ""}
            </option>
          ))}
          {printerLabel && !calibrations.some((c) => c.printer_label === printerLabel) && (
            <option value={printerLabel}>{printerLabel}</option>
          )}
        </select>
        <span className="text-xs text-muted-foreground">
          {isCalibrated
            ? `Korreksjon ${scaleXPct} % × ${scaleYPct} %`
            : "Skriveren er ikke kalibrert ennå — skriver ut i 100 %."}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCalibrateOpen(true)}>
            <Ruler className="mr-2 h-4 w-4" />
            Kalibrer
          </Button>
          <Button
            onClick={printChecked}
            disabled={flow.busy || items.length === 0}
          >
            {flow.busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Printer className="mr-2 h-4 w-4" />
            )}
            {flow.busy ? "Klargjør bildene…" : "Skriv ut"}
          </Button>
          <Button variant="outline" onClick={() => void downloadPdf()}>
            <Download className="mr-2 h-4 w-4" />
            Last ned PDF
          </Button>
        </div>
      </div>

      <p className="px-3 py-2 text-xs text-muted-foreground">
        Skriv ut i 100 % — slå av «tilpass til side». Mål kontrollskalaen nederst
        på arket: viser linjalen 50 mm, er størrelsen riktig.
      </p>

      {skipped.length > 0 && (
        <div className="mx-3 mb-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            {skipped.length} bilde(r) blir ikke skrevet ut
          </div>
          <ul className="list-disc pl-5">
            {skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-muted p-3">
        {previewUrl ? (
          <iframe
            title="Forhåndsvisning av kakebildeark"
            src={previewUrl}
            className="h-[80vh] w-full rounded-md border bg-background"
          />
        ) : (
          <div className="flex h-[40vh] items-center justify-center text-sm text-muted-foreground">
            {items.length === 0 ? "Ingen kakebilder valgt." : "Lager forhåndsvisning …"}
          </div>
        )}
      </div>

      {flow.dialog}
      <CalibratePrinterDialog open={calibrateOpen} onOpenChange={setCalibrateOpen} />
    </div>
  );
}

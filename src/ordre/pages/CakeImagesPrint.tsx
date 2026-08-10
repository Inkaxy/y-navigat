import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Printer, Download, Ruler } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CAKE_BUCKET, type CakeImage, markPrinted } from "@/ordre/lib/cakeImages";
import {
  buildCakeSheet,
  cakeSheetsToPdf,
  itemToPrint,
  openCakePrintWindow,
  CAKE_PRINT_CSS,
  type CakePrintItem,
} from "@/ordre/lib/cakePrint";
import { useCakeFormats } from "@/ordre/hooks/useCakeFormats";
import { useCakePrinterSelection } from "@/ordre/hooks/useCakeCalibration";
import { CalibratePrinterDialog } from "@/ordre/components/cake-images/CalibratePrinterDialog";
import { Button } from "@/components/ui/button";

/**
 * Utskriftsrute for kakebilder — én felles vei til papiret.
 * URL: /ordre/kakebilder/print?ids=a,b,c&auto=1
 *
 * Arket bygges av `cakePrint.ts`, i eksakte millimeter, med klippemerker,
 * etikettnummer, ordredetaljer og en 50 mm kontrollskala.
 */
export default function CakeImagesPrint() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ids = useMemo(
    () => (params.get("ids") || "").split(",").filter(Boolean),
    [params],
  );
  const auto = params.get("auto") === "1";
  const { data: formats = [] } = useCakeFormats();
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
  const [rows, setRows] = useState<{ image: CakeImage; url: string }[] | null>(
    null,
  );
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const autoDone = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (ids.length === 0) {
        setRows([]);
        return;
      }
      const { data } = await supabase.from("cake_images").select("*").in("id", ids);
      const list = (data ?? []) as CakeImage[];
      const paths = list.map((r) => r.edited_path || r.original_path);
      const { data: signed } = await supabase.storage
        .from(CAKE_BUCKET)
        .createSignedUrls(paths, 60 * 30);
      const urlMap = Object.fromEntries(
        (signed ?? []).map((s) => [s.path!, s.signedUrl!]),
      );
      if (cancelled) return;
      setRows(
        list.map((r) => ({
          image: r,
          url: urlMap[r.edited_path || r.original_path] ?? "",
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  const items: CakePrintItem[] = useMemo(() => {
    if (!rows) return [];
    return rows.map((r) =>
      itemToPrint(
        r.image,
        r.url,
        formats.find((f) => f.id === r.image.format_id) ?? null,
      ),
    );
  }, [rows, formats]);

  // Forhåndsvisning bruker nøyaktig samme DOM som papiret.
  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    host.replaceChildren();
    for (const item of items) {
      host.appendChild(buildCakeSheet(document, item, scale, scaleY));
    }
  }, [items, scale, scaleY]);

  /** Bare ekte utskrift setter status — derfor onafterprint, ikke knappetrykket. */
  const registerPrinted = async () => {
    if (!rows) return;
    const fresh = rows.filter((r) => r.image.status !== "skrevet_ut").map((r) => r.image.id);
    const again = rows.filter((r) => r.image.status === "skrevet_ut").map((r) => r.image.id);
    try {
      const printerMeta = { printerLabel, scaleAppliedPct: scaleXPct };
      if (fresh.length) await markPrinted(fresh, "print", "A4", null, printerMeta);
      if (again.length) await markPrinted(again, "reprint", "A4", null, printerMeta);
      toast.success(`${rows.length} kakebilde(r) registrert som skrevet ut`);
    } catch (e) {
      console.error("[CakeImagesPrint] kunne ikke registrere utskrift", e);
      toast.error("Kunne ikke registrere utskriften");
    }
  };

  const runPrint = async () => {
    if (items.length === 0 || preparing) return;
    setPreparing(true);
    try {
      await openCakePrintWindow(items, {
        scale,
        scaleY,
        title: "Kakebilder",
        onPrinted: () => void registerPrinted(),
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPreparing(false);
    }
  };


  useEffect(() => {
    if (auto && items.length > 0 && !autoDone.current) {
      autoDone.current = true;
      void runPrint();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, items]);

  const downloadPdf = async () => {
    if (items.length === 0) return;
    await cakeSheetsToPdf(items, { scale, scaleY, fileName: "kakebilder.pdf" });
    // PDF er ikke papir: logges, men flytter ikke status.
    await markPrinted(
      items.map((i) => i.image!.id),
      "pdf",
      "A4",
      null,
      { printerLabel, scaleAppliedPct: scaleXPct },
    );
    toast.success("PDF lastet ned (status er uendret)");
  };

  if (!rows) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <style>{`
        ${CAKE_PRINT_CSS}
        @media screen {
          .cake-preview { background: hsl(var(--muted)); padding: 16px 0; }
          .cake-preview .cake-sheet {
            box-shadow: 0 2px 12px rgba(0,0,0,.15);
            margin-bottom: 16px;
            border: 1px solid rgba(0,0,0,.1);
          }
        }
        @media print { .no-print { display: none !important; } .cake-preview { padding: 0; } }
      `}</style>

      <div className="no-print flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          Tilbake
        </Button>
        <div className="ml-2 text-sm font-semibold">
          {rows.length} kakebilde(r) — A4, faktisk størrelse
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
          <Button onClick={() => void runPrint()} disabled={preparing}>
            {preparing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Printer className="mr-2 h-4 w-4" />
            )}
            {preparing ? "Klargjør bildene…" : "Skriv ut"}
          </Button>
          <Button variant="outline" onClick={() => void downloadPdf()}>
            <Download className="mr-2 h-4 w-4" />
            Last ned PDF
          </Button>
        </div>
      </div>

      <p className="no-print px-3 py-2 text-xs text-muted-foreground">
        Skriv ut uten «tilpass til side» / «scale to fit». Mål kontrollskalaen
        nederst på arket: viser linjalen 50 mm, er størrelsen riktig.
      </p>

      <div ref={previewRef} className="cake-preview" />

      <CalibratePrinterDialog open={calibrateOpen} onOpenChange={setCalibrateOpen} />
    </div>
  );
}

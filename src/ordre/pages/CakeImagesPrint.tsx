import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Printer, Download } from "lucide-react";
import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { CAKE_BUCKET, type CakeImage, markPrinted } from "@/ordre/lib/cakeImages";
import { Button } from "@/components/ui/button";

/**
 * Print-rute for valgte kakebilder.
 * URL: /ordre/kakebilder/print?ids=a,b,c&auto=1
 * - auto=1 starter browser-print automatisk
 * - knapp for PDF-nedlasting
 */
export default function CakeImagesPrint() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ids = useMemo(
    () => (params.get("ids") || "").split(",").filter(Boolean),
    [params],
  );
  const auto = params.get("auto") === "1";
  const [items, setItems] = useState<
    { image: CakeImage; url: string }[] | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (ids.length === 0) {
        setItems([]);
        return;
      }
      const { data } = await supabase
        .from("cake_images")
        .select("*")
        .in("id", ids);
      const rows = (data ?? []) as CakeImage[];
      const paths = rows.map((r) => r.edited_path || r.original_path);
      const { data: signed } = await supabase.storage
        .from(CAKE_BUCKET)
        .createSignedUrls(paths, 60 * 30);
      const urlMap = Object.fromEntries(
        (signed ?? []).map((s) => [s.path!, s.signedUrl!]),
      );
      if (cancelled) return;
      setItems(
        rows.map((r) => ({
          image: r,
          url: urlMap[r.edited_path || r.original_path] ?? "",
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  // Marker som skrevet ut FØRST etter at nettleseren faktisk har printet.
  const runPrint = async () => {
    if (!items || items.length === 0) return;
    // Vent til alle bildene er lastet — ellers printes tomme sider.
    await Promise.all(
      items
        .filter((i) => i.url)
        .map(
          (i) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => resolve();
              img.onerror = () => resolve();
              img.src = i.url;
            }),
        ),
    );
    const ids = items.map((i) => i.image.id);
    const onAfterPrint = () => {
      window.removeEventListener("afterprint", onAfterPrint);
      markPrinted(ids).catch((e) =>
        console.error("[CakeImagesPrint] markPrinted feilet", e),
      );
    };
    window.addEventListener("afterprint", onAfterPrint);
    window.print();
  };

  useEffect(() => {
    if (auto && items && items.length > 0) {
      void runPrint();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, items]);


  const downloadPdf = async () => {
    if (!items) return;
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    for (let i = 0; i < items.length; i++) {
      if (i > 0) pdf.addPage();
      const url = items[i].url;
      const dataUrl = await urlToDataUrl(url);
      const dims = await imgDims(dataUrl);
      const ratio = Math.min(pageW / dims.w, pageH / dims.h) * 0.92;
      pdf.addImage(
        dataUrl,
        "PNG",
        (pageW - dims.w * ratio) / 2,
        (pageH - dims.h * ratio) / 2,
        dims.w * ratio,
        dims.h * ratio,
      );
    }
    pdf.save(`kakebilder.pdf`);
    markPrinted(items.map((i) => i.image.id));
  };

  if (!items) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="cake-print-root">
      <style>{`
        @media print {
          @page { size: auto; margin: 8mm; }
          .no-print { display: none !important; }
          .cake-print-page { page-break-after: always; break-after: page; height: 100vh; }
          body { background: white !important; }
        }
        .cake-print-page { position:relative; display:flex; align-items:center; justify-content:center; padding:24px; }
        .cake-print-page img { max-width:100%; max-height:90vh; object-fit:contain; }
      `}</style>

      <div className="no-print flex items-center gap-2 border-b bg-card px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          Tilbake
        </Button>
        <div className="ml-2 text-sm font-semibold">
          {items.length} kakebilde(r) — utskrift
        </div>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => void runPrint()}>
            <Printer className="mr-2 h-4 w-4" />
            Skriv ut
          </Button>
          <Button variant="outline" onClick={downloadPdf}>
            <Download className="mr-2 h-4 w-4" />
            Last ned PDF
          </Button>
        </div>
      </div>

      {items.map((it) => (
        <div key={it.image.id} className="cake-print-page">
          {it.image.label_number && (
            <div className="absolute left-6 top-6 rounded bg-black px-2 py-1 font-mono text-sm font-bold text-white no-print-hide">
              #{it.image.label_number}
            </div>
          )}
          {it.url ? (
            <img src={it.url} alt={it.image.title} />
          ) : (
            <span className="text-muted-foreground">Mangler bilde</span>
          )}
        </div>
      ))}
    </div>
  );
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
}

function imgDims(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = dataUrl;
  });
}

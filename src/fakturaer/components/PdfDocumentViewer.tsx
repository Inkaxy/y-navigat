import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Minus, Plus, RefreshCw, Maximize2 } from "lucide-react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
// Arbeideren bygges inn som egen fil i appen (førsteparts), ingen ekstern PDF-tjeneste.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { documentIdentity } from "@/fakturaer/lib/pdfIdentity";

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Bufret innhold er bare uforanderlige bytes + innholdsavtrykk. PDF-objekt og blob-lenker
 * eies av den monterte visningen og ryddes når den forsvinner (aldri delt via cache).
 */
export type DocBytes = { kind: "pdf" | "image"; bytes: Uint8Array<ArrayBuffer>; type: string; fingerprint: string };

async function fingerprintOf(buf: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", buf));
    return Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `len:${buf.byteLength}`;
}

export async function loadDocumentBytes(url: string): Promise<DocBytes> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Dokumentet svarte ${res.status}`);
  const buf = await res.arrayBuffer();
  const isPdf = String.fromCharCode(...new Uint8Array(buf.slice(0, 5))) === "%PDF-";
  const type = res.headers.get("content-type") ?? "";
  if (!isPdf && !type.startsWith("image/")) throw new Error("Ukjent dokumentformat");
  return { kind: isPdf ? "pdf" : "image", bytes: new Uint8Array(buf), type: isPdf ? "application/pdf" : type, fingerprint: await fingerprintOf(buf) };
}


interface Props {
  /** Signert lenke. Logges aldri. */
  url: string;
  /** Stabil nøkkel (lagringssti), slik at ny signering ikke laster dokumentet på nytt. */
  cacheKey: string;
  /** Lagringsobjektets versjon når den er kjent (f.eks. oppdatert tidspunkt). */
  version?: string | null;
  title: string;
  fallback: React.ReactNode;
  className?: string;
  /**
   * Leser gjeldende identitet på nytt ETTER nedlasting. Stemmer den ikke med `cacheKey|version`,
   * forkastes bytene (lagres aldri som gyldige) og «Originalen er endret» vises.
   */
  verifyIdentity?: () => Promise<string | null>;
  /** Bruker+selskap; bytecache deles aldri på tvers av tilgangskontekst. */
  accessScope?: string | null;
  /** Hent ny identitet (etter «Originalen er endret»). */
  onIdentityChanged?: () => void;
}

export class DocumentChangedError extends Error {
  constructor() { super("dokument_endret"); this.name = "DocumentChangedError"; }
}

/** Originaldokumentet tegnet med PDF.js i appen: sider, zoom, lasting, feil og «Prøv igjen». */
export function PdfDocumentViewer({ url, cacheKey, version, title, fallback, className, verifyIdentity, onIdentityChanged, accessScope }: Props) {
  const q = useQuery({
    queryKey: ["invoice-document-render", cacheKey, version ?? null, accessScope ?? null],
    queryFn: async () => {
      const expected = `${cacheKey}|${version ?? ""}`;
      // Før nedlasting: forventet identitet må fortsatt gjelde.
      if (verifyIdentity && (await verifyIdentity()) !== expected) throw new DocumentChangedError();
      const bytes = await loadDocumentBytes(url);
      // Kontrollen fullføres før bytene publiseres; ved avvik caches de aldri som gyldige.
      if (verifyIdentity && (await verifyIdentity()) !== expected) throw new DocumentChangedError();
      return bytes;
    },
    staleTime: 10 * 60_000, gcTime: 10 * 60_000,
    retry: (n, e) => !(e instanceof DocumentChangedError) && n < 1,
  });

  if (q.isLoading) return <Loading className={className} />;
  if (q.error instanceof DocumentChangedError) {
    return (
      <div role="alert" className={cn("flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm", className)}>
        <span>Originalen er endret mens den ble hentet. Ingenting fra den gamle versjonen vises.</span>
        <Button size="sm" variant="outline" className="min-h-11" onClick={() => { onIdentityChanged?.(); void q.refetch(); }}><RefreshCw className="h-4 w-4" /> Hent på nytt</Button>
      </div>
    );
  }
  if (q.isError || !q.data) return <Failed className={className} fallback={fallback} onRetry={() => void q.refetch()} busy={q.isFetching} />;
  // Ny identitet (annen sti, versjon eller innhold) gir ny visning: side, zoom og feil nullstilles.
  return <DocumentView key={documentIdentity(cacheKey, version, q.data.fingerprint)} data={q.data} title={title} fallback={fallback} className={className} onReload={() => void q.refetch()} />;
}

function Loading({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3 p-4", className)} role="status" aria-label="Laster originaldokumentet">
      <Skeleton className="h-6 w-1/3" /><Skeleton className="h-[60vh] w-full" />
    </div>
  );
}

function Failed({ className, fallback, onRetry, busy }: { className?: string; fallback: React.ReactNode; onRetry: () => void; busy?: boolean }) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-ink-secondary", className)}>
      <span>Dokumentet kunne ikke vises her.</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}><RefreshCw className="h-4 w-4" /> Prøv igjen</Button>
      {fallback}
    </div>
  );
}

function DocumentView({ data, title, fallback, className, onReload }: { data: DocBytes; title: string; fallback: React.ReactNode; className?: string; onReload: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  // Eierskap: denne visningen oppretter og rydder PDF-objekt/blob-lenke.
  useEffect(() => {
    setFailed(false); setDoc(null); setImgSrc(null);
    if (data.kind === "image") {
      const src = URL.createObjectURL(new Blob([data.bytes], { type: data.type }));
      setImgSrc(src);
      return () => URL.revokeObjectURL(src);
    }
    let cancelled = false;
    // PDF.js overtar bufferen den får; send en kopi så bufret innhold forblir intakt.
    const task = getDocument({ data: data.bytes.slice(), isEvalSupported: false });
    task.promise.then((d) => { if (!cancelled) setDoc(d); }, () => { if (!cancelled) { console.error("[dokumentvisning] dokumentet kunne ikke åpnes"); setFailed(true); } });
    return () => { cancelled = true; void task.destroy(); };
  }, [data, attempt]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc, imgSrc]);

  const pages = doc?.numPages ?? 0;

  useEffect(() => {
    if (!doc || !canvasRef.current || width <= 0) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    void (async () => {
      try {
        const p = await doc.getPage(Math.min(page, doc.numPages));
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const scale = zoom === "fit" ? Math.max(0.2, (width - 16) / base.width) : zoom;
        const vp = p.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;
        const c = canvasRef.current;
        if (!c) return;
        c.width = Math.floor(vp.width * dpr);
        c.height = Math.floor(vp.height * dpr);
        c.style.width = `${Math.floor(vp.width)}px`;
        c.style.height = `${Math.floor(vp.height)}px`;
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("Lerret mangler");
        task = p.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
        await task.promise;
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) {
          console.error("[dokumentvisning] side kunne ikke tegnes");
          setFailed(true);
        }
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, page, zoom, width]);

  // «Prøv igjen» henter dokumentet på nytt OG åpner det på nytt.
  if (failed) return <Failed className={className} fallback={fallback} onRetry={() => { onReload(); setAttempt((n) => n + 1); }} />;
  if (data.kind === "pdf" && !doc) return <Loading className={className} />;

  const zoomPct = zoom === "fit" ? null : Math.round(zoom * 100);
  const step = (d: number) => setZoom((z) => Math.min(4, Math.max(0.5, Math.round(((z === "fit" ? 1 : z) + d) * 100) / 100)));

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {doc && (
        <div className="flex flex-wrap items-center gap-1 border-b border-line-subtle px-2 py-1 text-sm">
          <Button size="icon" variant="ghost" aria-label="Forrige side" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="tabular-nums" aria-live="polite">Side {Math.min(page, pages)} av {pages}</span>
          <Button size="icon" variant="ghost" aria-label="Neste side" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          <span className="ml-auto" />
          <Button size="icon" variant="ghost" aria-label="Zoom ut" onClick={() => step(-0.25)}><Minus className="h-4 w-4" /></Button>
          <span className="w-14 text-center tabular-nums">{zoomPct == null ? "Bredde" : `${zoomPct} %`}</span>
          <Button size="icon" variant="ghost" aria-label="Zoom inn" onClick={() => step(0.25)}><Plus className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="Tilpass bredde" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}><Maximize2 className="h-4 w-4" /></Button>
        </div>
      )}
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-auto bg-muted/30 p-2">
        {imgSrc ? (
          <img src={imgSrc} alt={title} className="mx-auto max-w-full" />
        ) : (
          <canvas ref={canvasRef} role="img" aria-label={`${title}, side ${page}`} className="mx-auto block bg-card shadow-sm" />
        )}
      </div>
    </div>
  );
}

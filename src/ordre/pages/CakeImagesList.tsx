import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CakeSlice, Printer, CheckCircle2, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { todayISO } from "@/ordre/lib/format";
import {
  useCakeImageList,
  useCakeOrderMeta,
  useSignedUrls,
} from "@/ordre/hooks/useCakeImages";
import { useProductionDepartments } from "@/produksjon/features/produksjonsavdelinger/hooks/useProductionDepartments";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CakeImageCard } from "@/ordre/components/cake-images/CakeImageCard";
import { UploadButton } from "@/ordre/components/cake-images/UploadButton";
import { deleteCakeImage, markPrinted, updateCakeImage } from "@/ordre/lib/cakeImages";
import { useCakePrintFlow } from "@/ordre/hooks/useCakePrintFlow";
import { useCakePrinterSelection } from "@/ordre/hooks/useCakeCalibration";

type Status = "for-utskrift" | "skrevet-ut";

const TABS: { key: Status; label: string; icon: typeof Printer }[] = [
  { key: "for-utskrift", label: "For utskrift", icon: Printer },
  { key: "skrevet-ut", label: "Skrevet ut", icon: CheckCircle2 },
];

export default function CakeImagesList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { printerLabel, scaleX, scaleY, scaleXPct } = useCakePrinterSelection();
  const printFlow = useCakePrintFlow({
    scale: scaleX,
    scaleY,
    printerLabel,
    scaleAppliedPct: scaleXPct,
  });
  const status = (searchParams.get("status") as Status) || "for-utskrift";
  const date = searchParams.get("date") || todayISO();

  const { data: allImages = [], isLoading } = useCakeImageList(date, status);
  const focus = searchParams.get("filter") || "";
  const tourFilter = searchParams.get("tour") || "";
  const deptFilter = searchParams.get("dept") || "";

  const { data: orderMeta = {} } = useCakeOrderMeta(
    allImages.map((i) => i.order_id ?? null),
  );
  const { data: departments = [] } = useProductionDepartments(NB_LEGAL_ENTITY_ID, false);

  const tours = useMemo(() => {
    const map = new Map<string, string>();
    for (const img of allImages) {
      const m = img.order_id ? orderMeta[img.order_id] : null;
      if (m?.delivery_tour_id) {
        map.set(m.delivery_tour_id, m.tour_name ?? "Tur");
      }
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [allImages, orderMeta]);

  /**
   * Køen sorteres etter hva som haster: det som stopper produksjonen først.
   * Lav kvalitet uten bekreftelse > mangler ordrekobling > uredigerte > ferdige.
   */
  const priority = (img: (typeof allImages)[number]) => {
    if (img.quality_flag === "lav" && !img.quality_ack_at) return 0;
    if (!img.order_id) return 1;
    if (img.status === "venter") return 2;
    return 3;
  };

  const images = useMemo(() => {
    let list = allImages;
    if (focus === "mangler-kobling") list = list.filter((i) => !i.order_id);
    if (focus === "lav-kvalitet")
      list = list.filter((i) => i.quality_flag === "lav" && !i.quality_ack_at);
    if (tourFilter)
      list = list.filter(
        (i) =>
          i.order_id && orderMeta[i.order_id]?.delivery_tour_id === tourFilter,
      );
    if (deptFilter)
      list = list.filter((i) => i.production_department_id === deptFilter);
    return [...list].sort((a, b) => {
      const p = priority(a) - priority(b);
      if (p !== 0) return p;
      return Number(a.resolved_label_number ?? Number.MAX_SAFE_INTEGER) -
        Number(b.resolved_label_number ?? Number.MAX_SAFE_INTEGER);
    });
  }, [allImages, focus, tourFilter, deptFilter, orderMeta]);

  const setParam = (key: string, value: string) => {
    setSearchParams(
      (prev) => {
        const np = new URLSearchParams(prev);
        if (value) np.set(key, value);
        else np.delete(key);
        return np;
      },
      { replace: true },
    );
  };

  const paths = useMemo(
    () => images.map((i) => i.edited_path || i.original_path),
    [images],
  );
  const urls = useSignedUrls(paths);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) => {
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  };

  const setStatus = (next: Status) => {
    setSearchParams(
      (prev) => {
        const np = new URLSearchParams(prev);
        np.set("status", next);
        return np;
      },
      { replace: true },
    );
    setSelected(new Set());
  };

  // Utskriften bygges i samme fane, rett fra klikket — ingen popup å sperre.
  const printSelected = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    void printFlow.printIds(ids);
  };

  const pdfSelected = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    navigate(`/ordre/kakebilder/print?ids=${ids.join(",")}`);
  };

  const readyIds = useMemo(
    () => images.filter((i) => i.status === "ferdig_redigert").map((i) => i.id),
    [images],
  );

  const missingOrderCount = useMemo(
    () => images.filter((i) => !i.order_id).length,
    [images],
  );


  const printAllReady = () => {
    if (readyIds.length === 0) return;
    void printFlow.printIds(readyIds);
  };

  const markFerdig = async () => {
    await Promise.all(
      Array.from(selected).map((id) =>
        updateCakeImage(id, { status: "ferdig_redigert" }),
      ),
    );
    toast.success(`${selected.size} markert som ferdig redigert`);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["cake-images"] });
  };

  const markSkrevetUt = async () => {
    await markPrinted(Array.from(selected));
    toast.success(`${selected.size} markert som skrevet ut`);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["cake-images"] });
  };

  const deleteSelected = async () => {
    if (!confirm(`Slette ${selected.size} bilde(r)?`)) return;
    await Promise.all(
      images.filter((i) => selected.has(i.id)).map((i) => deleteCakeImage(i)),
    );
    toast.success("Slettet");
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["cake-images"] });
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 space-y-4">
      {printFlow.dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/ordre/kakebilder?date=${date}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Tilbake
          </Link>
        </Button>
        <div className="flex items-center gap-2 text-muted-foreground">
          <CakeSlice className="h-5 w-5 text-brand-bronze" />
          <span className="text-sm font-semibold uppercase tracking-wide">
            Kakebilder · {date}
          </span>
        </div>
        <UploadButton date={date} />
      </div>

      {status === "for-utskrift" && readyIds.length > 0 && (
        <div className="flex justify-end">
          <Button size="sm" variant="default" onClick={printAllReady}>
            <Printer className="mr-2 h-4 w-4" />
            Skriv ut alle ferdig redigerte ({readyIds.length})
          </Button>
        </div>
      )}

      {missingOrderCount > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{missingOrderCount}</strong> bilde(r) mangler ordrekobling og
            har derfor ikke etikettnummer. Bruk «Koble til ordre» på kortet for å
            koble dem — ellers kan de ikke pares med kaken i produksjonen.
          </span>
        </div>
      )}




      <div className="flex flex-wrap items-center gap-2">
        <Select value={tourFilter || "all"} onValueChange={(v) => setParam("tour", v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 w-[190px]">
            <SelectValue placeholder="Alle turer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle turer</SelectItem>
            {tours.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={deptFilter || "all"} onValueChange={(v) => setParam("dept", v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 w-[190px]">
            <SelectValue placeholder="Alle avdelinger" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle avdelinger</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {focus && (
          <Button size="sm" variant="outline" onClick={() => setParam("filter", "")}>
            Fjern filter: {focus === "lav-kvalitet" ? "lav kvalitet" : "mangler ordre"}
          </Button>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          {images.length} av {allImages.length} vises
        </span>
      </div>

      <div
        role="tablist"
        className="mx-auto flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === status;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setStatus(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-ink text-brand-cream shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow">
          <span className="text-sm font-semibold">{selected.size} valgt</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="default" onClick={printSelected}>
              <Printer className="mr-2 h-4 w-4" />
              Skriv ut valgte
            </Button>
            <Button size="sm" variant="outline" onClick={pdfSelected}>
              PDF
            </Button>
            {status === "for-utskrift" && (
              <>
                <Button size="sm" variant="outline" onClick={markFerdig}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Marker ferdig
                </Button>
                <Button size="sm" variant="outline" onClick={markSkrevetUt}>
                  Marker som skrevet ut
                </Button>
              </>
            )}
            <Button size="sm" variant="destructive" onClick={deleteSelected}>
              <Trash2 className="mr-2 h-4 w-4" />
              Slett
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : images.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/50 p-10 text-center">
          <CakeSlice className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-base font-medium">
            {status === "for-utskrift"
              ? "Ingen kakebilder venter på utskrift."
              : "Ingen kakebilder er markert som skrevet ut."}
          </p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Last opp et bilde, eller legg til demo-bilder for å teste flyten.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {images.map((img) => (
            <CakeImageCard
              key={img.id}
              image={img}
              thumbUrl={urls[img.edited_path || img.original_path]}
              selected={selected.has(img.id)}
              onToggle={toggle}
              order={img.order_id ? orderMeta[img.order_id] : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

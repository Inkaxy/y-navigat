import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as fabric from "fabric";
import {
  ArrowLeft,
  Bold,
  Download,
  FlipHorizontal,
  Italic,
  Layers as LayersIcon,
  Loader2,
  Plus,
  Printer,
  Redo2,
  RotateCw,
  Save,
  Square,
  CheckCircle2,
  Trash2,
  Type as TypeIcon,
  Undo2,
  ZoomIn,
  ZoomOut,
  Image as ImageIcon,
  Cookie,
  Cake,
  Heart,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import jsPDF from "jspdf";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

import { useCakeImage, useSignedUrls } from "@/ordre/hooks/useCakeImages";
import {
  CAKE_BUCKET,
  markPrinted,
  signedUrl,
  updateCakeImage,
  uploadEditedPng,
  uploadOriginal,
} from "@/ordre/lib/cakeImages";
import { supabase } from "@/integrations/supabase/client";

const TEMPLATES = [
  { id: "qland", label: '1/4 ark — landskap (10×7,5")', w: 1000, h: 750 },
  { id: "qport", label: '1/4 ark — portrett (7,5×10")', w: 750, h: 1000 },
  { id: "round8", label: '8" rund', w: 800, h: 800, circle: true },
  { id: "card", label: "Visittkort (8,9×5,1 cm)", w: 890, h: 510 },
] as const;
type TemplateId = (typeof TEMPLATES)[number]["id"];

const TEXT_PRESETS = [
  { id: "title", label: "Tittel (stor)", size: 72, weight: "bold" },
  { id: "subtitle", label: "Undertittel", size: 44, weight: "600" },
  { id: "label", label: "Etikett (liten)", size: 24, weight: "normal" },
];

const CLIPART: { id: string; label: string; Icon: typeof Cake }[] = [
  { id: "cake", label: "Kake", Icon: Cake },
  { id: "cookie", label: "Kjeks", Icon: Cookie },
  { id: "heart", label: "Hjerte", Icon: Heart },
  { id: "bag", label: "Pose", Icon: ShoppingBag },
];

function iconSvg(id: string): string {
  // Enkle SVG-er (samme set som lucide ville rendret). Bredde/høyde settes via Fabric.
  switch (id) {
    case "cake":
      return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#1f1b16' stroke-width='1.5'><path d='M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8'/><path d='M4 16s1.5-2 4-2 3.5 2 6 2 4-2 4-2'/><path d='M2 21h20'/><path d='M7 8v2'/><path d='M12 8v2'/><path d='M17 8v2'/><path d='M7 4h.01'/><path d='M12 4h.01'/><path d='M17 4h.01'/></svg>`;
    case "cookie":
      return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#1f1b16' stroke-width='1.5'><path d='M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5'/><path d='M8.5 8.5v.01'/><path d='M16 15.5v.01'/><path d='M12 12v.01'/><path d='M11 17v.01'/><path d='M7 14v.01'/></svg>`;
    case "heart":
      return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='#e94560' stroke='#1f1b16' stroke-width='1.5'><path d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z'/></svg>`;
    case "bag":
      return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#1f1b16' stroke-width='1.5'><path d='M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z'/><path d='M3 6h18'/><path d='M16 10a4 4 0 0 1-8 0'/></svg>`;
  }
  return "";
}

export default function CakeImageEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: image, isLoading } = useCakeImage(id);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabRef = useRef<fabric.Canvas | null>(null);

  const [template, setTemplate] = useState<TemplateId>("qland");
  const tpl = useMemo(() => TEMPLATES.find((t) => t.id === template)!, [template]);

  const [zoom, setZoom] = useState(0.6);
  const [textInput, setTextInput] = useState("");
  const [textPreset, setTextPreset] = useState("title");
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [grayscale, setGrayscale] = useState(false);
  const [selVersion, setSelVersion] = useState(0); // tvinger re-render av høyre-panel
  const [layers, setLayers] = useState<fabric.Object[]>([]);
  const [saving, setSaving] = useState(false);

  // Undo/redo (enkel snapshot-stack av canvas.toJSON())
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const skipSnapshotRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // signed URL til original / redigert
  const paths = useMemo(
    () => [image?.original_path, image?.edited_path].filter(Boolean) as string[],
    [image?.original_path, image?.edited_path],
  );
  const urls = useSignedUrls(paths);

  // ---- init Fabric ----
  useEffect(() => {
    if (!canvasRef.current) return;
    const c = new fabric.Canvas(canvasRef.current, {
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
      width: tpl.w,
      height: tpl.h,
    });
    fabRef.current = c;

    const refreshLayers = () => setLayers([...c.getObjects()]);
    const bumpSel = () => setSelVersion((v) => v + 1);
    const snapshot = () => {
      if (skipSnapshotRef.current) return;
      undoStack.current.push(JSON.stringify(c.toJSON()));
      if (undoStack.current.length > 50) undoStack.current.shift();
      redoStack.current = [];
    };

    c.on("object:added", () => {
      refreshLayers();
      snapshot();
    });
    c.on("object:removed", () => {
      refreshLayers();
      snapshot();
    });
    c.on("object:modified", () => {
      refreshLayers();
      snapshot();
    });
    c.on("selection:created", bumpSel);
    c.on("selection:updated", bumpSel);
    c.on("selection:cleared", bumpSel);

    return () => {
      c.dispose();
      fabRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sett mal-størrelse / rund-clip
  useEffect(() => {
    const c = fabRef.current;
    if (!c) return;
    c.setDimensions({ width: tpl.w, height: tpl.h });
    if ("circle" in tpl && tpl.circle) {
      c.clipPath = new fabric.Circle({
        radius: Math.min(tpl.w, tpl.h) / 2,
        originX: "center",
        originY: "center",
        left: tpl.w / 2,
        top: tpl.h / 2,
        absolutePositioned: true,
      });
    } else {
      c.clipPath = undefined;
    }
    c.renderAll();
  }, [tpl]);

  // Last inn lagret state / original
  useEffect(() => {
    const c = fabRef.current;
    if (!c || !image) return;
    skipSnapshotRef.current = true;

    const load = async () => {
      if (image.editor_state) {
        try {
          await c.loadFromJSON(image.editor_state as never);
          c.renderAll();
          setLayers([...c.getObjects()]);
          undoStack.current = [JSON.stringify(c.toJSON())];
          redoStack.current = [];
          skipSnapshotRef.current = false;
          return;
        } catch (e) {
          console.warn("editor_state load failed", e);
        }
      }
      // Init med original-bilde sentrert
      const url = await signedUrl(image.original_path);
      if (!url) {
        skipSnapshotRef.current = false;
        return;
      }
      const img = await fabric.FabricImage.fromURL(url, { crossOrigin: "anonymous" });
      const cw = c.getWidth();
      const ch = c.getHeight();
      const scale = Math.min(cw / img.width!, ch / img.height!) * 0.95;
      img.scale(scale);
      img.set({ left: cw / 2, top: ch / 2, originX: "center", originY: "center" });
      c.add(img);
      c.renderAll();
      setLayers([...c.getObjects()]);
      undoStack.current = [JSON.stringify(c.toJSON())];
      redoStack.current = [];
      skipSnapshotRef.current = false;
    };
    load();
  }, [image]);

  // ---- helpers ----
  const active = fabRef.current?.getActiveObject() ?? null;
  const isText = active && (active as fabric.IText).isType?.("i-text");

  const addText = () => {
    const c = fabRef.current;
    if (!c) return;
    const preset = TEXT_PRESETS.find((p) => p.id === textPreset)!;
    const txt = new fabric.IText(textInput || "Tekst", {
      left: c.getWidth() / 2,
      top: c.getHeight() / 2,
      originX: "center",
      originY: "center",
      fontFamily: "Inter",
      fontSize: preset.size,
      fontWeight: preset.weight,
      fill: "#1f1b16",
    });
    c.add(txt);
    c.setActiveObject(txt);
    c.renderAll();
    setTextInput("");
  };

  const addClipart = async (cid: string) => {
    const c = fabRef.current;
    if (!c) return;
    const svg = iconSvg(cid);
    const dataUrl = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    const img = await fabric.FabricImage.fromURL(dataUrl);
    img.scaleToWidth(160);
    img.set({ left: c.getWidth() / 2, top: c.getHeight() / 2, originX: "center", originY: "center" });
    c.add(img);
    c.setActiveObject(img);
    c.renderAll();
  };

  const addImageFromFile = async (file: File) => {
    const c = fabRef.current;
    if (!c) return;
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = await fabric.FabricImage.fromURL(dataUrl);
    img.scaleToWidth(Math.min(c.getWidth() * 0.6, img.width || 600));
    img.set({ left: c.getWidth() / 2, top: c.getHeight() / 2, originX: "center", originY: "center" });
    c.add(img);
    c.setActiveObject(img);
    c.renderAll();
  };

  const deleteActive = () => {
    const c = fabRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (obj) {
      c.remove(obj);
      c.discardActiveObject();
      c.renderAll();
    }
  };

  const rotateActive = (deg = 15) => {
    const c = fabRef.current;
    const obj = c?.getActiveObject();
    if (!obj || !c) return;
    obj.rotate(((obj.angle ?? 0) + deg) % 360);
    c.renderAll();
    setSelVersion((v) => v + 1);
  };

  const flipActive = () => {
    const c = fabRef.current;
    const obj = c?.getActiveObject();
    if (!obj || !c) return;
    obj.set("flipX", !obj.flipX);
    c.renderAll();
    setSelVersion((v) => v + 1);
  };

  const resizeActive = (factor: number) => {
    const c = fabRef.current;
    const obj = c?.getActiveObject();
    if (!obj || !c) return;
    obj.scaleX = (obj.scaleX ?? 1) * factor;
    obj.scaleY = (obj.scaleY ?? 1) * factor;
    obj.setCoords();
    c.renderAll();
    setSelVersion((v) => v + 1);
  };

  const applyImageFilters = () => {
    const c = fabRef.current;
    const obj = c?.getActiveObject();
    if (!obj || !c) return;
    if (!(obj instanceof fabric.FabricImage)) return;
    const filters: fabric.filters.BaseFilter<string>[] = [];
    if (brightness !== 0)
      filters.push(new fabric.filters.Brightness({ brightness: brightness / 100 }));
    if (contrast !== 0)
      filters.push(new fabric.filters.Contrast({ contrast: contrast / 100 }));
    if (grayscale) filters.push(new fabric.filters.Grayscale());
    obj.filters = filters;
    obj.applyFilters();
    c.renderAll();
  };

  useEffect(() => {
    applyImageFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brightness, contrast, grayscale]);

  const undo = () => {
    const c = fabRef.current;
    if (!c || undoStack.current.length <= 1) return;
    const cur = undoStack.current.pop()!;
    redoStack.current.push(cur);
    const prev = undoStack.current[undoStack.current.length - 1];
    skipSnapshotRef.current = true;
    c.loadFromJSON(JSON.parse(prev)).then(() => {
      c.renderAll();
      setLayers([...c.getObjects()]);
      skipSnapshotRef.current = false;
    });
  };
  const redo = () => {
    const c = fabRef.current;
    if (!c || redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    skipSnapshotRef.current = true;
    c.loadFromJSON(JSON.parse(next)).then(() => {
      c.renderAll();
      setLayers([...c.getObjects()]);
      undoStack.current.push(next);
      skipSnapshotRef.current = false;
    });
  };

  const renderPng = async (): Promise<Blob> => {
    const c = fabRef.current!;
    const dataUrl = c.toDataURL({ format: "png", multiplier: 2 });
    const res = await fetch(dataUrl);
    return await res.blob();
  };

  const doSave = async (markFerdig = false): Promise<boolean> => {
    if (!image || !fabRef.current) return false;
    setSaving(true);
    try {
      const blob = await renderPng();
      const editedPath = await uploadEditedPng(blob, image.delivery_date);
      // Slett tidligere edited-fil for å unngå opphopning
      if (image.edited_path) {
        await supabase.storage.from(CAKE_BUCKET).remove([image.edited_path]);
      }
      await updateCakeImage(image.id, {
        edited_path: editedPath,
        editor_state: fabRef.current.toJSON() as never,
        status: markFerdig ? "ferdig_redigert" : image.status === "skrevet_ut" ? image.status : "venter",
      });
      qc.invalidateQueries({ queryKey: ["cake-images"] });
      qc.invalidateQueries({ queryKey: ["cake-image", image.id] });
      toast.success(markFerdig ? "Lagret og markert som ferdig redigert" : "Lagret");
      return true;
    } catch (e) {
      toast.error("Kunne ikke lagre", { description: String((e as Error).message) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const printNow = async () => {
    const c = fabRef.current!;
    const dataUrl = c.toDataURL({ format: "png", multiplier: 2 });
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(`<html><head><title>${image?.title ?? "Kakebilde"}</title>
<style>
@page { size: auto; margin: 10mm; }
body { margin:0; display:flex; align-items:center; justify-content:center; min-height:100vh; }
img { max-width:100%; max-height:100vh; }
</style></head><body><img src="${dataUrl}" onload="window.focus();window.print();" /></body></html>`);
    w.document.close();
    if (image) {
      await markPrinted([image.id]);
      qc.invalidateQueries({ queryKey: ["cake-images"] });
    }
  };

  const downloadPdf = async () => {
    const c = fabRef.current!;
    const dataUrl = c.toDataURL({ format: "png", multiplier: 2 });
    const orientation = tpl.w >= tpl.h ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageW / tpl.w, pageH / tpl.h) * 0.92;
    const drawW = tpl.w * ratio;
    const drawH = tpl.h * ratio;
    pdf.addImage(dataUrl, "PNG", (pageW - drawW) / 2, (pageH - drawH) / 2, drawW, drawH);
    pdf.save(`${image?.title ?? "kakebilde"}.pdf`);
    if (image) {
      await markPrinted([image.id]);
      qc.invalidateQueries({ queryKey: ["cake-images"] });
    }
  };

  if (isLoading || !image) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      {/* Topp toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Tilbake
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <Button variant="ghost" size="sm" onClick={undo}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={redo}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <Button variant="ghost" size="sm" onClick={() => resizeActive(1.1)}>
          <Plus className="h-4 w-4" />
          Større
        </Button>
        <Button variant="ghost" size="sm" onClick={() => resizeActive(0.9)}>
          <Square className="h-4 w-4" />
          Mindre
        </Button>
        <Button variant="ghost" size="sm" onClick={() => rotateActive(15)}>
          <RotateCw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={flipActive}>
          <FlipHorizontal className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={deleteActive}>
          <Trash2 className="h-4 w-4" />
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <div className="ml-auto flex items-center gap-2">
          <ZoomOut className="h-4 w-4 text-muted-foreground" />
          <Slider
            min={0.2}
            max={1.5}
            step={0.05}
            value={[zoom]}
            onValueChange={(v) => setZoom(v[0])}
            className="w-32"
          />
          <ZoomIn className="h-4 w-4 text-muted-foreground" />
          <span className="w-10 text-right text-xs tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
        </div>
      </div>

      {/* 3 kolonner */}
      <div className="grid flex-1 min-h-0 grid-cols-[260px_1fr_280px]">
        {/* Venstre panel */}
        <aside className="overflow-y-auto border-r bg-background p-3">
          <Accordion type="multiple" defaultValue={["mal", "bilde", "tekst"]}>
            <AccordionItem value="mal">
              <AccordionTrigger className="text-sm">Maler</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTemplate(t.id)}
                      className={cn(
                        "rounded-md border p-2 text-left text-xs hover:bg-accent",
                        template === t.id && "border-primary ring-1 ring-primary",
                      )}
                    >
                      <div
                        className={cn(
                          "mx-auto mb-1 border bg-muted",
                          "circle" in t && t.circle ? "rounded-full" : "rounded-sm",
                        )}
                        style={{
                          width: 60,
                          height: (60 * t.h) / t.w,
                          maxHeight: 60,
                        }}
                      />
                      <div className="truncate">{t.label}</div>
                    </button>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="bilde">
              <AccordionTrigger className="text-sm">Bilder</AccordionTrigger>
              <AccordionContent>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) addImageFromFile(f);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon className="mr-2 h-4 w-4" />
                  Legg til bilde-lag
                </Button>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="tekst">
              <AccordionTrigger className="text-sm">Tekst</AccordionTrigger>
              <AccordionContent className="space-y-2">
                <Select value={textPreset} onValueChange={setTextPreset}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEXT_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Skriv tekst …"
                  className="h-8"
                />
                <Button size="sm" className="w-full" onClick={addText}>
                  <TypeIcon className="mr-2 h-4 w-4" />
                  Legg til tekst
                </Button>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="clipart">
              <AccordionTrigger className="text-sm">Clipart</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-3 gap-2">
                  {CLIPART.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => addClipart(c.id)}
                      className="flex aspect-square flex-col items-center justify-center rounded-md border bg-muted text-xs hover:bg-accent"
                    >
                      <c.Icon className="mb-1 h-6 w-6" />
                      {c.label}
                    </button>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </aside>

        {/* Lerret */}
        <div
          ref={wrapRef}
          className="relative overflow-auto bg-[hsl(var(--muted))] p-6"
          style={{ backgroundImage: "linear-gradient(45deg,hsl(var(--muted)) 25%,transparent 25%),linear-gradient(-45deg,hsl(var(--muted)) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,hsl(var(--muted)) 75%),linear-gradient(-45deg,transparent 75%,hsl(var(--muted)) 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0" }}
        >
          <div
            className="mx-auto bg-white shadow-lg"
            style={{
              width: tpl.w * zoom,
              height: tpl.h * zoom,
              transform: "translateZ(0)",
            }}
          >
            <div
              style={{
                width: tpl.w,
                height: tpl.h,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
            >
              <canvas ref={canvasRef} />
            </div>
          </div>
        </div>

        {/* Høyre panel */}
        <aside className="overflow-y-auto border-l bg-background p-3">
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tittel</Label>
              <Input
                value={image.title}
                onChange={(e) =>
                  updateCakeImage(image.id, { title: e.target.value }).then(() =>
                    qc.invalidateQueries({ queryKey: ["cake-image", image.id] }),
                  )
                }
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Kunde</Label>
              <Input
                defaultValue={image.customer_name ?? ""}
                onBlur={(e) =>
                  updateCakeImage(image.id, { customer_name: e.target.value || null })
                }
                className="h-8"
              />
            </div>

            <Separator />

            <div className="flex items-center gap-2 text-sm font-semibold">
              <LayersIcon className="h-4 w-4" />
              Lag
            </div>
            <div className="space-y-1">
              {layers.length === 0 && (
                <p className="text-xs text-muted-foreground">Ingen lag enda.</p>
              )}
              {[...layers].reverse().map((o, i) => {
                const label =
                  o instanceof fabric.IText
                    ? `T: ${(o.text ?? "").slice(0, 18)}`
                    : o instanceof fabric.FabricImage
                      ? "Bilde"
                      : o.type ?? "Objekt";
                return (
                  <button
                    key={i}
                    onClick={() => {
                      fabRef.current?.setActiveObject(o);
                      fabRef.current?.renderAll();
                      setSelVersion((v) => v + 1);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded border px-2 py-1 text-left text-xs",
                      active === o ? "border-primary bg-accent" : "border-border",
                    )}
                  >
                    <span className="truncate">{label}</span>
                    <Trash2
                      className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        fabRef.current?.remove(o);
                        fabRef.current?.renderAll();
                      }}
                    />
                  </button>
                );
              })}
            </div>

            <Separator />

            {isText && active && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">Tekst</div>
                <Input
                  value={(active as fabric.IText).text ?? ""}
                  onChange={(e) => {
                    (active as fabric.IText).set("text", e.target.value);
                    fabRef.current?.renderAll();
                    setSelVersion((v) => v + 1);
                  }}
                  className="h-8"
                />
                <div className="flex items-center gap-1">
                  <Button
                    variant={(active as fabric.IText).fontWeight === "bold" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      const cur = (active as fabric.IText).fontWeight;
                      (active as fabric.IText).set("fontWeight", cur === "bold" ? "normal" : "bold");
                      fabRef.current?.renderAll();
                      setSelVersion((v) => v + 1);
                    }}
                  >
                    <Bold className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={(active as fabric.IText).fontStyle === "italic" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      const cur = (active as fabric.IText).fontStyle;
                      (active as fabric.IText).set("fontStyle", cur === "italic" ? "normal" : "italic");
                      fabRef.current?.renderAll();
                      setSelVersion((v) => v + 1);
                    }}
                  >
                    <Italic className="h-4 w-4" />
                  </Button>
                  <Input
                    type="color"
                    value={((active as fabric.IText).fill as string) ?? "#000000"}
                    onChange={(e) => {
                      (active as fabric.IText).set("fill", e.target.value);
                      fabRef.current?.renderAll();
                    }}
                    className="h-8 w-12 p-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Størrelse: {Math.round((active as fabric.IText).fontSize ?? 0)}</Label>
                  <Slider
                    min={10}
                    max={200}
                    step={1}
                    value={[(active as fabric.IText).fontSize ?? 40]}
                    onValueChange={(v) => {
                      (active as fabric.IText).set("fontSize", v[0]);
                      fabRef.current?.renderAll();
                      setSelVersion((x) => x + 1);
                    }}
                  />
                </div>
              </div>
            )}

            {active instanceof fabric.FabricImage && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">Bildejustering</div>
                <div>
                  <Label className="text-xs">Lysstyrke: {brightness}</Label>
                  <Slider min={-100} max={100} step={1} value={[brightness]} onValueChange={(v) => setBrightness(v[0])} />
                </div>
                <div>
                  <Label className="text-xs">Kontrast: {contrast}</Label>
                  <Slider min={-100} max={100} step={1} value={[contrast]} onValueChange={(v) => setContrast(v[0])} />
                </div>
                <Button
                  variant={grayscale ? "default" : "outline"}
                  size="sm"
                  onClick={() => setGrayscale((g) => !g)}
                >
                  Gråtoner
                </Button>
              </div>
            )}

            <Separator />

            <div className="space-y-1 text-xs text-muted-foreground">
              <div>Status: {image.status}</div>
              <div>Skrevet ut: {image.print_count}×</div>
            </div>
          </div>
        </aside>
      </div>

      {/* Bunn-bar */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-card px-3 py-2">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Avbryt
        </Button>
        <Button variant="outline" onClick={() => doSave(false)} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Lagre
        </Button>
        <Button variant="default" onClick={() => doSave(true)} disabled={saving}>
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Lagre & marker ferdig
        </Button>
        <Button variant="brand" onClick={async () => { if (await doSave(false)) printNow(); }}>
          <Printer className="mr-2 h-4 w-4" />
          Skriv ut
        </Button>
        <Button variant="outline" onClick={async () => { if (await doSave(false)) downloadPdf(); }}>
          <Download className="mr-2 h-4 w-4" />
          PDF
        </Button>
      </div>
      {/* tving re-render når selVersion endres */}
      <span hidden>{selVersion}</span>
      {/* uses urls just to keep hook stable */}
      <span hidden>{Object.keys(urls).length}</span>
    </div>
  );
}

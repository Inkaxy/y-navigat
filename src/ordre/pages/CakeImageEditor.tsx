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
  AlertTriangle,
  Ruler,
  ShieldCheck,
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
  updateCakeImageGuarded,
  CakeImageConflictError,
} from "@/ordre/lib/cakeImages";
import { supabase } from "@/integrations/supabase/client";
import { CakeFontPicker } from "@/ordre/components/cake-images/CakeFontPicker";
import { loadCakeFont } from "@/ordre/lib/cakeFonts";

import { useCakeFormats, defaultFormat } from "@/ordre/hooks/useCakeFormats";
import {
  computeEffectiveDpi,
  formatDims,
  formatSizeLabel,
  qualityFlagFor,
  qualityMessage,
  sheetFit,
  type CakeImageFormat,
} from "@/ordre/lib/cakeFormats";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

/** Nåværende versjon av editor_state-formatet vi skriver. */
const EDITOR_STATE_VERSION = 2;


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

const CANVAS_JSON_PROPS = ["cakeStoragePath"];

type CakeFabricImage = fabric.FabricImage & { cakeStoragePath?: string };

function canvasSnapshot(canvas: fabric.Canvas) {
  const toJSON = (canvas as unknown as {
    toJSON: (propertiesToInclude?: string[]) => unknown;
  }).toJSON;
  return JSON.stringify(toJSON.call(canvas, CANVAS_JSON_PROPS));
}

function extractCakePathFromUrl(src: unknown) {
  if (typeof src !== "string" || src.startsWith("data:")) return null;
  try {
    const url = new URL(src, window.location.origin);
    const marker = `/${CAKE_BUCKET}/`;
    const idx = url.pathname.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(url.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
}

async function prepareEditorStateForLoad(state: unknown) {
  const cloned = JSON.parse(JSON.stringify(state)) as unknown;
  const cache = new Map<string, string | null>();

  const resolve = async (path: string) => {
    if (!cache.has(path)) cache.set(path, await cakeObjectUrl(path));
    return cache.get(path) ?? null;
  };

  const walk = async (node: unknown): Promise<void> => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      await Promise.all(node.map(walk));
      return;
    }

    const obj = node as Record<string, unknown>;
    const path =
      typeof obj.cakeStoragePath === "string"
        ? obj.cakeStoragePath
        : extractCakePathFromUrl(obj.src);

    if (path && typeof obj.src === "string") {
      const refreshed = await resolve(path);
      if (refreshed) {
        obj.src = refreshed;
        obj.crossOrigin = "anonymous";
        obj.cakeStoragePath = path;
      }
    }

    await Promise.all(Object.values(obj).map(walk));
  };

  await walk(cloned);
  return cloned;
}

async function cakeObjectUrl(path: string | null | undefined) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(CAKE_BUCKET).download(path);
  if (!error && data) return URL.createObjectURL(data);
  return signedUrl(path);
}

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

  // Formatene kommer fra basen — lerretet settes opp fra fysisk størrelse.
  const { data: formats = [] } = useCakeFormats();
  const [formatId, setFormatId] = useState<string>("");
  const format: CakeImageFormat | null =
    formats.find((f) => f.id === formatId) ?? null;
  const dims = useMemo(
    () =>
      format
        ? formatDims(format)
        : {
            widthMm: 0,
            heightMm: 0,
            isRound: false,
            bleedMm: 0,
            widthPx: 1000,
            heightPx: 750,
            bleedPx: 0,
          },
    [format],
  );
  const fit = format ? sheetFit(format) : null;

  const [zoom, setZoom] = useState(0.25);
  const [textInput, setTextInput] = useState("");
  const [textPreset, setTextPreset] = useState("title");
  const [fontFamily, setFontFamily] = useState<string>("Inter");
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [grayscale, setGrayscale] = useState(false);
  const [selVersion, setSelVersion] = useState(0); // tvinger re-render av høyre-panel
  const [layers, setLayers] = useState<fabric.Object[]>([]);
  const [saving, setSaving] = useState(false);
  const [stateLoadFailed, setStateLoadFailed] = useState(false);
  const [rightsCleared, setRightsCleared] = useState(false);
  const [rightsNote, setRightsNote] = useState("");
  const [qualityAcked, setQualityAcked] = useState(false);


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
      backgroundColor: "",
      preserveObjectStacking: true,
      width: dims.widthPx,
      height: dims.heightPx,
    });
    fabRef.current = c;

    const refreshLayers = () => setLayers([...c.getObjects()]);
    const bumpSel = () => setSelVersion((v) => v + 1);
    const snapshot = () => {
      if (skipSnapshotRef.current) return;
      undoStack.current.push(canvasSnapshot(c));
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

  // Velg format: bildets eget, ellers standardformatet (Rund 20 cm).
  useEffect(() => {
    if (formatId || formats.length === 0) return;
    const own = image?.format_id
      ? formats.find((f) => f.id === image.format_id)
      : null;
    setFormatId((own ?? defaultFormat(formats))?.id ?? "");
  }, [formats, image?.format_id, formatId]);

  // Rettigheter / kvalitetsbekreftelse fra raden
  useEffect(() => {
    if (!image) return;
    setRightsCleared(!!image.rights_cleared);
    setRightsNote(image.rights_note ?? "");
    setQualityAcked(!!image.quality_ack_at);
  }, [image?.id, image?.rights_cleared, image?.rights_note, image?.quality_ack_at]);

  // Lerretet settes opp fra fysisk størrelse, ikke omvendt.
  useEffect(() => {
    const c = fabRef.current;
    if (!c) return;
    c.setDimensions({ width: dims.widthPx, height: dims.heightPx });
    if (dims.isRound) {
      c.clipPath = new fabric.Circle({
        radius: Math.min(dims.widthPx, dims.heightPx) / 2,
        originX: "center",
        originY: "center",
        left: dims.widthPx / 2,
        top: dims.heightPx / 2,
        absolutePositioned: true,
      });
    } else {
      c.clipPath = undefined;
    }
    c.renderAll();
  }, [dims]);

  // Last inn lagret state / original
  useEffect(() => {
    const c = fabRef.current;
    if (!c || !image) return;
    skipSnapshotRef.current = true;

    const loadOriginal = async () => {
      const url = await cakeObjectUrl(image.original_path);
      if (!url) {
        skipSnapshotRef.current = false;
        return;
      }
      const img = await fabric.FabricImage.fromURL(url, { crossOrigin: "anonymous" });
      (img as CakeFabricImage).cakeStoragePath = image.original_path;
      const cw = c.getWidth();
      const ch = c.getHeight();
      const scale = Math.min(cw / img.width!, ch / img.height!) * 0.95;
      img.scale(scale);
      img.set({ left: cw / 2, top: ch / 2, originX: "center", originY: "center" });
      c.add(img);
      c.renderAll();
      setLayers([...c.getObjects()]);
      undoStack.current = [canvasSnapshot(c)];
      redoStack.current = [];
      skipSnapshotRef.current = false;
    };

    const load = async () => {
      if (image.editor_state) {
        try {
          await c.loadFromJSON((await prepareEditorStateForLoad(image.editor_state)) as never);
          if (c.getObjects().length > 0) {
            // Preload alle skrifttyper som brukes i lagret state, og re-render.
            const families = new Set<string>();
            c.getObjects().forEach((o) => {
              const f = (o as fabric.IText).fontFamily;
              if (typeof f === "string") families.add(f);
            });
            await Promise.all([...families].map((f) => loadCakeFont(f)));
            c.renderAll();
            setLayers([...c.getObjects()]);
            undoStack.current = [canvasSnapshot(c)];
            redoStack.current = [];
            skipSnapshotRef.current = false;
            setStateLoadFailed(false);
            return;
          }
        } catch (e) {
          console.error("[CakeImageEditor] editor_state kunne ikke åpnes", e);
        }
        // Redigeringen kunne ikke åpnes. Vi tømmer IKKE lerretet i stillhet —
        // vi viser originalbildet og sier tydelig fra.
        setStateLoadFailed(true);
      }
      await loadOriginal();
    };
    load();
  }, [image]);


  // ---- helpers ----
  const active = fabRef.current?.getActiveObject() ?? null;
  const isText = active && (active as fabric.IText).isType?.("i-text");

  const addText = async () => {
    const c = fabRef.current;
    if (!c) return;
    const preset = TEXT_PRESETS.find((p) => p.id === textPreset)!;
    await loadCakeFont(fontFamily);
    const txt = new fabric.IText(textInput || "Tekst", {
      left: c.getWidth() / 2,
      top: c.getHeight() / 2,
      originX: "center",
      originY: "center",
      fontFamily,
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

  // Lerretet er allerede i 300 DPI — ingen ekstra multiplier, ellers blir
  // filen dobbelt så stor uten å bli skarpere.
  const renderPng = async (): Promise<Blob> => {
    const c = fabRef.current!;
    const dataUrl = c.toDataURL({ format: "png", multiplier: 1 });
    const res = await fetch(dataUrl);
    return await res.blob();
  };

  // Kvalitet regnes på nytt hver gang formatet endres — et bilde som holder
  // til kvartark holder ikke til A4.
  const effectiveDpi = computeEffectiveDpi(
    image?.source_width_px ?? null,
    image?.source_height_px ?? null,
    format,
  );
  const qualityFlag = qualityFlagFor(effectiveDpi);
  const needsQualityAck = qualityFlag === "lav" && !qualityAcked;
  const rightsAnswered = rightsCleared || (rightsNote.trim().length > 0);
  const canMarkFerdig = !needsQualityAck && rightsAnswered;

  const doSave = async (
    markFerdig = false,
    opts: { navigateBack?: boolean } = {},
  ): Promise<boolean> => {
    if (!image || !fabRef.current) return false;
    if (markFerdig && !canMarkFerdig) {
      toast.error(
        needsQualityAck
          ? "Bekreft at bildet skal trykkes selv om oppløsningen er lav"
          : "Ta stilling til rettighetene før bildet markeres ferdig",
      );
      return false;
    }
    setSaving(true);
    try {
      const blob = await renderPng();
      const editedPath = await uploadEditedPng(blob, image.delivery_date);
      // Optimistisk låsing mot raden slik den ble lastet — hindrer at to
      // redaktører overskriver hverandre.
      const { previousEditedPath } = await updateCakeImageGuarded(
        image.id,
        image.updated_at,
        {
          edited_path: editedPath,
          editor_state: JSON.parse(canvasSnapshot(fabRef.current)) as never,
          editor_state_version: EDITOR_STATE_VERSION,
          // Et vanlig «Lagre» skal ALDRI nedgradere et ferdigmarkert bilde.
          // Statusen endres bare når brukeren aktivt ber om det.
          status: markFerdig ? "ferdig_redigert" : image.status,
          format_id: format?.id ?? image.format_id ?? null,
          shape: format?.shape ?? image.shape ?? null,
          width_mm: format ? formatDims(format).widthMm : (image.width_mm ?? null),
          height_mm: format ? formatDims(format).heightMm : (image.height_mm ?? null),
          effective_dpi: effectiveDpi,
          quality_flag: qualityFlag,
          rights_cleared: rightsCleared,
          rights_note: rightsNote.trim() || null,
        },
      );
      // Rydd forrige edited-fil basert på DB-verdien (ikke lokal state)
      if (previousEditedPath && previousEditedPath !== editedPath) {
        await supabase.storage.from(CAKE_BUCKET).remove([previousEditedPath]);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["cake-images"] }),
        qc.invalidateQueries({ queryKey: ["cake-image", image.id] }),
      ]);
      toast.success(
        markFerdig ? "Lagret og markert som ferdig redigert" : "Lagret",
      );
      if (opts.navigateBack) {
        navigate(
          `/ordre/kakebilder/liste?date=${image.delivery_date}&status=for-utskrift`,
        );
      }
      return true;
    } catch (e) {
      if (e instanceof CakeImageConflictError) {
        // Rydd opp den nye filen vi nettopp lastet opp forgjeves
        await qc.invalidateQueries({ queryKey: ["cake-image", image.id] });
        toast.error("Noen andre lagret dette kakebildet", {
          description: "Bildet er lastet på nytt — gjør endringene om igjen.",
        });
        return false;
      }
      console.error("[CakeImageEditor] save failed", e);
      toast.error("Kunne ikke lagre", {
        description: String((e as Error).message ?? e),
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Bekreft lav oppløsning — lagres på raden så noen har tatt stilling. */
  const ackQuality = async () => {
    if (!image) return;
    const { data: u } = await supabase.auth.getUser();
    await updateCakeImage(image.id, {
      quality_ack_by: u.user?.id ?? null,
      quality_ack_at: new Date().toISOString(),
      effective_dpi: effectiveDpi,
      quality_flag: qualityFlag,
    });
    setQualityAcked(true);
    qc.invalidateQueries({ queryKey: ["cake-image", image.id] });
  };


  const printNow = async () => {
    const c = fabRef.current!;
    const dataUrl = c.toDataURL({ format: "png", multiplier: 2 });
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;

    // Bygg dokumentet med DOM-API — aldri string-interpolering av brukerdata
    // (en tittel som «</title><script>…» ville ellers kjørt kode i vår origin).
    const doc = w.document;
    doc.title = image?.title ?? "Kakebilde";
    const style = doc.createElement("style");
    style.textContent = `
@page { size: auto; margin: 10mm; }
body { margin:0; display:flex; align-items:center; justify-content:center; min-height:100vh; }
img { max-width:100%; max-height:100vh; }`;
    doc.head.appendChild(style);
    const img = doc.createElement("img");
    img.src = dataUrl;
    img.alt = image?.title ?? "Kakebilde";
    const imageId = image?.id ?? null;
    w.addEventListener("afterprint", () => {
      if (!imageId) return;
      // Marker først NÅR utskriften faktisk er utført
      markPrinted([imageId])
        .then(() => qc.invalidateQueries({ queryKey: ["cake-images"] }))
        .catch((e) => console.error("[CakeImageEditor] markPrinted feilet", e));
    });
    img.onload = () => {
      w.focus();
      w.print();
    };
    doc.body.appendChild(img);
  };


  const downloadPdf = async () => {
    const c = fabRef.current!;
    const dataUrl = c.toDataURL({ format: "png", multiplier: 1 });
    // Millimeter styrer alt: bildet plasseres i eksakt fysisk størrelse på A4.
    const orientation = dims.widthMm >= dims.heightMm ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const drawW = dims.widthMm;
    const drawH = dims.heightMm;

    pdf.addImage(dataUrl, "PNG", (pageW - drawW) / 2, (pageH - drawH) / 2, drawW, drawH);
    const safeName = (image?.title ?? "kakebilde").replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 80) || "kakebilde";
    pdf.save(`${safeName}.pdf`);

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
              <AccordionTrigger className="text-sm">
                Format og størrelse
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-2 gap-2">
                  {formats.map((f) => {
                    const d = formatDims(f);
                    return (
                      <button
                        key={f.id}
                        onClick={() => setFormatId(f.id)}
                        className={cn(
                          "rounded-md border p-2 text-left text-xs hover:bg-accent",
                          formatId === f.id && "border-primary ring-1 ring-primary",
                        )}
                      >
                        <div
                          className={cn(
                            "mx-auto mb-1 border bg-muted",
                            d.isRound ? "rounded-full" : "rounded-sm",
                          )}
                          style={{
                            width: 60,
                            height: (60 * d.heightMm) / (d.widthMm || 1),
                            maxHeight: 60,
                          }}
                        />
                        <div className="truncate font-medium">{f.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {d.isRound
                            ? `Ø ${d.widthMm} mm`
                            : `${d.widthMm} × ${d.heightMm} mm`}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {format && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/40 p-2 text-xs">
                    <Ruler className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{formatSizeLabel(format)}</span>
                  </div>
                )}

                {fit && !fit.fits && (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{fit.message}</span>
                  </div>
                )}

                {dims.bleedMm > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {dims.bleedMm} mm utfallende sone rundt kanten klippes bort —
                    la bildet gå helt ut, ellers blir det hvit rand.
                  </p>
                )}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="kvalitet">
              <AccordionTrigger className="text-sm">
                Kvalitet og rettigheter
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <div
                  className={cn(
                    "rounded-md border p-2 text-xs",
                    qualityFlag === "lav"
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : qualityFlag === "akseptabel"
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "bg-muted/40",
                  )}
                >
                  {qualityMessage(effectiveDpi, format)}
                </div>

                {qualityFlag === "lav" && (
                  <label className="flex items-start gap-2 text-xs">
                    <Checkbox
                      checked={qualityAcked}
                      onCheckedChange={(v) => {
                        if (v) void ackQuality();
                        else setQualityAcked(false);
                      }}
                    />
                    <span>
                      Jeg har sett oppløsningen og vil trykke bildet likevel.
                    </span>
                  </label>
                )}

                <Separator />

                <label className="flex items-start gap-2 text-xs">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <Checkbox
                    checked={rightsCleared}
                    onCheckedChange={(v) => setRightsCleared(!!v)}
                  />
                  <span>Rettigheter avklart</span>
                </label>
                <Textarea
                  value={rightsNote}
                  onChange={(e) => setRightsNote(e.target.value)}
                  rows={2}
                  placeholder="Notat om rettigheter (hvem har godkjent, kilde …)"
                  className="text-xs"
                />
                {!rightsAnswered && (
                  <p className="text-[11px] text-muted-foreground">
                    Ta stilling til rettighetene før bildet markeres ferdig.
                  </p>
                )}
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
                <div>
                  <Label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
                    Skrifttype
                  </Label>
                  <CakeFontPicker value={fontFamily} onChange={setFontFamily} />
                </div>
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
            className={cn(
              "mx-auto bg-white shadow-lg",
              "circle" in tpl && tpl.circle ? "rounded-full" : "",
            )}
            style={{
              width: tpl.w * zoom,
              height: tpl.h * zoom,
              transform: "translateZ(0)",
              overflow: "hidden",
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
                <div>
                  <Label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
                    Skrifttype
                  </Label>
                  <CakeFontPicker
                    compact
                    value={((active as fabric.IText).fontFamily as string) ?? "Inter"}
                    onChange={(family) => {
                      loadCakeFont(family).then(() => {
                        (active as fabric.IText).set("fontFamily", family);
                        fabRef.current?.renderAll();
                        setSelVersion((v) => v + 1);
                      });
                    }}
                  />
                </div>
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
        <Button variant="outline" onClick={() => doSave(false, { navigateBack: true })} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Lagre
        </Button>
        <Button variant="default" onClick={() => doSave(true, { navigateBack: true })} disabled={saving}>
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

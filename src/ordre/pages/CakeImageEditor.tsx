import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as fabric from "fabric";
import { initAligningGuidelines } from "fabric/extensions";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cake,
  Cookie,
  Download,
  Heart,
  Image as ImageIcon,
  Layers as LayersIcon,
  Loader2,
  Maximize,
  Printer,
  Redo2,
  Ruler,
  Save,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  Type as TypeIcon,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

import { useCakeImage } from "@/ordre/hooks/useCakeImages";
import {
  CAKE_BUCKET,
  markPrinted,
  signedUrl,
  updateCakeImage,
  uploadEditedPng,
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
import {
  cakeSheetsToPdf,
  type CakePrintItem,
} from "@/ordre/lib/cakePrint";
import { useCakePrinterSelection } from "@/ordre/hooks/useCakeCalibration";
import { useCakePrintFlow } from "@/ordre/hooks/useCakePrintFlow";
import { fetchCakeLineDetails } from "@/ordre/lib/cakeImages";
import { withResolvedLabelNumbers } from "@/ordre/lib/labelNumber";
import { CakePrintHistory } from "@/ordre/components/cake-images/CakePrintHistory";
import { showError } from "@/lib/userError";
import { fitZoom, pxPerMm } from "@/ordre/lib/cakeEditorMath";
import { loadCakeSource, loadCakeSourceFromUrl } from "@/ordre/lib/cakeSource";
import {
  CakeTextPanel,
  applyTextCurve,
  type CakeCurvedText,
} from "@/ordre/components/cake-images/CakeTextPanel";
import { CakeImageLayerPanel } from "@/ordre/components/cake-images/CakeImageLayerPanel";
import { CakeLayerList, type CakeLayerAction } from "@/ordre/components/cake-images/CakeLayerList";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";

/** Nåværende versjon av editor_state-formatet vi skriver. */
const EDITOR_STATE_VERSION = 2;

const CANVAS_JSON_PROPS = [
  "cakeStoragePath",
  "cakeFilters",
  "cakeCurveRadius",
  "cakeCurveDirection",
  "selectable",
  "evented",
  "visible",
];

const AUTOSAVE_MS = 10_000;
const draftKey = (id: string) => `cake-editor-draft-${id}`;

type CakeFabricImage = fabric.FabricImage & { cakeStoragePath?: string };

const CLIPART: { id: string; label: string; Icon: typeof Cake }[] = [
  { id: "cake", label: "Kake", Icon: Cake },
  { id: "cookie", label: "Kjeks", Icon: Cookie },
  { id: "heart", label: "Hjerte", Icon: Heart },
  { id: "bag", label: "Pose", Icon: ShoppingBag },
];

const TEXT_TEMPLATES = [
  { id: "navn-alder", label: "Navn + alder" },
  { id: "gratulerer", label: "Gratulerer med dagen" },
  { id: "fritekst", label: "Fritekst" },
] as const;

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

async function cakeObjectUrl(path: string | null | undefined) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(CAKE_BUCKET).download(path);
  if (!error && data) return URL.createObjectURL(data);
  return signedUrl(path);
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

function iconSvg(id: string): string {
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

function useIsCompact() {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 1024,
  );
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)");
    const onChange = () => setCompact(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return compact;
}

export default function CakeImageEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const compact = useIsCompact();
  const {
    printerLabel,
    scaleX: printScale,
    scaleY: printScaleY,
    scaleXPct: printScalePct,
    scaleYPct: printScaleYPct,
    isCalibrated: printerCalibrated,
  } = useCakePrinterSelection();
  const printFlow = useCakePrintFlow({
    scale: printScale,
    scaleY: printScaleY,
    printerLabel,
    scaleAppliedPct: printScalePct,
  });
  const { data: image, isLoading } = useCakeImage(id);


  const viewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabRef = useRef<fabric.Canvas | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);

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
  const dimsRef = useRef(dims);
  const fit = format ? sheetFit(format) : null;

  const [zoom, setZoomState] = useState(0.25);
  const [textInput, setTextInput] = useState("");
  const [fontFamily, setFontFamily] = useState<string>("Inter");
  const [selVersion, setSelVersion] = useState(0);
  const [activeObj, setActiveObj] = useState<fabric.Object | null>(null);
  const [layers, setLayers] = useState<fabric.Object[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [stateLoadFailed, setStateLoadFailed] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [rightsCleared, setRightsCleared] = useState(false);
  const [rightsNote, setRightsNote] = useState("");
  const [qualityAcked, setQualityAcked] = useState(false);
  const [title, setTitle] = useState("");
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const skipSnapshotRef = useRef(false);
  const exportingRef = useRef(false);
  const spaceRef = useRef(false);
  const loadedIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const guard = useUnsavedChangesGuard(dirty);

  useEffect(() => {
    dimsRef.current = dims;
  }, [dims]);

  const refreshStacks = useCallback(() => {
    setCanUndo(undoStack.current.length > 1);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  const snapshot = useCallback(() => {
    const c = fabRef.current;
    if (!c || skipSnapshotRef.current) return;
    const snap = canvasSnapshot(c);
    if (undoStack.current[undoStack.current.length - 1] === snap) return;
    undoStack.current.push(snap);
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
    setDirty(true);
    setLayers([...c.getObjects()]);
    setSelVersion((v) => v + 1);
    refreshStacks();
  }, [refreshStacks]);

  const live = useCallback(() => {
    fabRef.current?.requestRenderAll();
    setSelVersion((v) => v + 1);
  }, []);

  // ---- Visning: zoom og panorering i viewportTransform ----
  const applyZoom = useCallback((z: number, point?: fabric.Point) => {
    const c = fabRef.current;
    if (!c) return;
    const next = Math.max(0.05, Math.min(4, z));
    if (point) c.zoomToPoint(point, next);
    else c.setZoom(next);
    setZoomState(next);
    c.requestRenderAll();
  }, []);

  const fitToView = useCallback(() => {
    const c = fabRef.current;
    if (!c) return;
    const d = dimsRef.current;
    const z = fitZoom(d.widthPx, d.heightPx, c.getWidth(), c.getHeight(), 48);
    c.setViewportTransform([
      z,
      0,
      0,
      z,
      (c.getWidth() - d.widthPx * z) / 2,
      (c.getHeight() - d.heightPx * z) / 2,
    ]);
    setZoomState(z);
    c.requestRenderAll();
  }, []);

  // ---- init Fabric ----
  useEffect(() => {
    if (!canvasRef.current || !viewRef.current) return;
    fabric.config.textureSize = 8192;
    const c = new fabric.Canvas(canvasRef.current, {
      backgroundColor: "",
      preserveObjectStacking: true,
      enableRetinaScaling: false,
      width: viewRef.current.clientWidth || 800,
      height: viewRef.current.clientHeight || 600,
    });
    fabRef.current = c;
    const disposeGuides = initAligningGuidelines(c);

    const onChanged = () => snapshot();
    const onSelection = () => {
      setActiveObj(c.getActiveObject() ?? null);
      setSelVersion((v) => v + 1);
    };
    c.on("object:added", onChanged);
    c.on("object:removed", onChanged);
    c.on("object:modified", onChanged);
    c.on("selection:created", onSelection);
    c.on("selection:updated", onSelection);
    c.on("selection:cleared", onSelection);

    // Papiret og hjelpelinjene tegnes rundt objektene (ikke med i eksporten).
    c.on("before:render", ({ ctx }: { ctx: CanvasRenderingContext2D }) => {
      if (exportingRef.current) return;
      const d = dimsRef.current;
      const vpt = c.viewportTransform;
      ctx.save();
      ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
      ctx.fillStyle = "#ffffff";
      if (d.isRound) {
        ctx.beginPath();
        ctx.arc(d.widthPx / 2, d.heightPx / 2, Math.min(d.widthPx, d.heightPx) / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(0, 0, d.widthPx, d.heightPx);
      }
      ctx.restore();
    });

    c.on("after:render", ({ ctx }: { ctx: CanvasRenderingContext2D }) => {
      if (exportingRef.current) return;
      const d = dimsRef.current;
      const vpt = c.viewportTransform;
      ctx.save();
      ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
      ctx.lineWidth = 2 / (vpt[0] || 1);
      ctx.strokeStyle = "rgba(31,27,22,0.35)";
      if (d.isRound) {
        ctx.beginPath();
        ctx.arc(d.widthPx / 2, d.heightPx / 2, Math.min(d.widthPx, d.heightPx) / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(0, 0, d.widthPx, d.heightPx);
      }
      if (d.bleedPx > 0) {
        ctx.setLineDash([12 / (vpt[0] || 1), 8 / (vpt[0] || 1)]);
        ctx.strokeStyle = "rgba(200,60,60,0.7)";
        if (d.isRound) {
          ctx.beginPath();
          ctx.arc(
            d.widthPx / 2,
            d.heightPx / 2,
            Math.max(1, Math.min(d.widthPx, d.heightPx) / 2 - d.bleedPx),
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        } else {
          ctx.strokeRect(
            d.bleedPx,
            d.bleedPx,
            Math.max(1, d.widthPx - 2 * d.bleedPx),
            Math.max(1, d.heightPx - 2 * d.bleedPx),
          );
        }
      }
      ctx.restore();
    });

    // Hjul- og pinch-zoom, panorering med mellomrom eller Alt.
    c.on("mouse:wheel", (opt) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      applyZoom(c.getZoom() * Math.exp(-dy * 0.0015), opt.scenePoint ?? undefined);
    });

    let panning = false;
    let lastX = 0;
    let lastY = 0;
    c.on("mouse:down", (opt) => {
      const e = opt.e as MouseEvent;
      if (!spaceRef.current && !e.altKey) return;
      panning = true;
      c.selection = false;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    c.on("mouse:move", (opt) => {
      if (!panning) return;
      const e = opt.e as MouseEvent;
      const vpt = c.viewportTransform;
      vpt[4] += e.clientX - lastX;
      vpt[5] += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      c.setViewportTransform(vpt);
    });
    c.on("mouse:up", () => {
      panning = false;
      c.selection = true;
    });

    const ro = new ResizeObserver(() => {
      const el = viewRef.current;
      if (!el) return;
      c.setDimensions({ width: el.clientWidth, height: el.clientHeight });
      c.requestRenderAll();
    });
    ro.observe(viewRef.current);

    setCanvasReady(true);

    return () => {
      ro.disconnect();
      disposeGuides();
      c.dispose();
      fabRef.current = null;
      setCanvasReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pinch-zoom på touch
  useEffect(() => {
    const c = fabRef.current;
    const el = c?.upperCanvasEl;
    if (!c || !el) return;
    let startDist = 0;
    let startZoom = 1;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDist = dist(e.touches);
      startZoom = c.getZoom();
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      applyZoom((dist(e.touches) / startDist) * startZoom, new fabric.Point(cx, cy));
    };
    const onEnd = () => {
      startDist = 0;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [canvasReady, applyZoom]);

  // Velg format: bildets eget, ellers standardformatet.
  useEffect(() => {
    if (formatId || formats.length === 0) return;
    const own = image?.format_id
      ? formats.find((f) => f.id === image.format_id)
      : null;
    setFormatId((own ?? defaultFormat(formats))?.id ?? "");
  }, [formats, image?.format_id, formatId]);

  // Rettigheter, kvalitet og tittel — kun når vi bytter bilde.
  useEffect(() => {
    if (!image) return;
    setRightsCleared(!!image.rights_cleared);
    setRightsNote(image.rights_note ?? "");
    setQualityAcked(!!image.quality_ack_at);
    setTitle(image.title ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id]);

  // Formatbytte: masken oppdateres og innholdet re-sentreres/re-tilpasses.
  const prevDimsRef = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const c = fabRef.current;
    if (!c) return;
    c.clipPath = dims.isRound
      ? new fabric.Circle({
          radius: Math.min(dims.widthPx, dims.heightPx) / 2,
          originX: "center",
          originY: "center",
          left: dims.widthPx / 2,
          top: dims.heightPx / 2,
          absolutePositioned: true,
        })
      : new fabric.Rect({
          width: dims.widthPx,
          height: dims.heightPx,
          left: 0,
          top: 0,
          absolutePositioned: true,
        });

    const prev = prevDimsRef.current;
    if (prev && (prev.w !== dims.widthPx || prev.h !== dims.heightPx) && c.getObjects().length) {
      const k = Math.min(dims.widthPx / prev.w, dims.heightPx / prev.h);
      c.getObjects().forEach((o) => {
        o.set({
          scaleX: (o.scaleX ?? 1) * k,
          scaleY: (o.scaleY ?? 1) * k,
          left: dims.widthPx / 2 + ((o.left ?? 0) - prev.w / 2) * k,
          top: dims.heightPx / 2 + ((o.top ?? 0) - prev.h / 2) * k,
        });
        o.setCoords();
      });
      snapshot();
    }
    prevDimsRef.current = { w: dims.widthPx, h: dims.heightPx };
    fitToView();
  }, [dims, fitToView, snapshot, canvasReady]);

  // ---- Last inn lagret state / original — kun når bilde-ID endres ----
  const imageRef = useRef(image);
  imageRef.current = image;

  const loadOriginal = useCallback(async () => {
    const c = fabRef.current;
    const img = imageRef.current;
    if (!c || !img) return;
    setLoadingSource(true);
    setSourceError(null);
    try {
      const url = await cakeObjectUrl(img.original_path);
      if (!url) throw new Error("Bildet finnes ikke i lageret");
      const src = await loadCakeSourceFromUrl(url);
      const fabImg = await fabric.FabricImage.fromURL(src.url, {
        crossOrigin: "anonymous",
      });
      (fabImg as CakeFabricImage).cakeStoragePath = img.original_path;
      const d = dimsRef.current;
      const scale = Math.min(d.widthPx / fabImg.width!, d.heightPx / fabImg.height!) * 0.95;
      fabImg.scale(scale);
      fabImg.set({
        left: d.widthPx / 2,
        top: d.heightPx / 2,
        originX: "center",
        originY: "center",
      });
      c.add(fabImg);
      c.requestRenderAll();
    } catch (e) {
      console.error("[CakeImageEditor] kilden kunne ikke åpnes", e);
      setSourceError(
        "Bildefilen kunne ikke åpnes i nettleseren. Be om filen som JPG eller PNG, eller last den opp på nytt.",
      );
    } finally {
      setLoadingSource(false);
    }
  }, []);

  useEffect(() => {
    const c = fabRef.current;
    if (!c || !image || !canvasReady) return;
    if (loadedIdRef.current === image.id) return;
    loadedIdRef.current = image.id;

    const finish = () => {
      const canvas = fabRef.current;
      if (!canvas) return;
      undoStack.current = [canvasSnapshot(canvas)];
      redoStack.current = [];
      skipSnapshotRef.current = false;
      setLayers([...canvas.getObjects()]);
      setDirty(false);
      refreshStacks();
      fitToView();
    };

    const load = async () => {
      skipSnapshotRef.current = true;
      if (image.editor_state) {
        try {
          await c.loadFromJSON(
            (await prepareEditorStateForLoad(image.editor_state)) as never,
          );
          if (c.getObjects().length > 0) {
            const families = new Set<string>();
            c.getObjects().forEach((o) => {
              const f = (o as fabric.Textbox).fontFamily;
              if (typeof f === "string") families.add(f);
            });
            await Promise.all([...families].map((f) => loadCakeFont(f)));
            c.requestRenderAll();
            setStateLoadFailed(false);
            finish();
            return;
          }
        } catch (e) {
          console.error("[CakeImageEditor] editor_state kunne ikke åpnes", e);
        }
        setStateLoadFailed(true);
      }
      await loadOriginal();
      finish();
    };
    void load();

    // Finnes et lokalt utkast som er nyere enn det lagrede?
    try {
      const raw = window.localStorage.getItem(draftKey(image.id));
      if (raw) {
        const parsed = JSON.parse(raw) as { ts?: string };
        if (parsed?.ts && parsed.ts > (image.updated_at ?? "")) setDraftPrompt(raw);
      }
    } catch {
      // et ødelagt utkast skal ikke stoppe editoren
    }
  }, [image, canvasReady, loadOriginal, fitToView, refreshStacks]);

  // ---- Autolagring til nettleseren ----
  useEffect(() => {
    if (!image?.id) return;
    const t = window.setInterval(() => {
      const c = fabRef.current;
      if (!c || !dirty) return;
      try {
        window.localStorage.setItem(
          draftKey(image.id),
          JSON.stringify({ ts: new Date().toISOString(), state: canvasSnapshot(c) }),
        );
      } catch {
        // fullt lager — ikke noe brukeren skal stoppes av
      }
    }, AUTOSAVE_MS);
    return () => window.clearInterval(t);
  }, [image?.id, dirty]);

  const restoreDraft = async () => {
    const c = fabRef.current;
    if (!c || !draftPrompt) return;
    try {
      const parsed = JSON.parse(draftPrompt) as { state: string };
      skipSnapshotRef.current = true;
      await c.loadFromJSON(
        (await prepareEditorStateForLoad(JSON.parse(parsed.state))) as never,
      );
      c.requestRenderAll();
      setLayers([...c.getObjects()]);
      skipSnapshotRef.current = false;
      undoStack.current.push(canvasSnapshot(c));
      setDirty(true);
      refreshStacks();
      toast.success("Utkastet er gjenopprettet");
    } catch {
      toast.error("Utkastet kunne ikke gjenopprettes");
    } finally {
      setDraftPrompt(null);
    }
  };

  // ---- Handlinger på lerretet ----
  const addTemplateText = async (template: (typeof TEXT_TEMPLATES)[number]["id"]) => {
    const c = fabRef.current;
    if (!c) return;
    await loadCakeFont(fontFamily);
    const d = dimsRef.current;
    const conf =
      template === "navn-alder"
        ? { text: textInput || "Navn\n5 år", size: d.widthPx * 0.11, top: 0.42 }
        : template === "gratulerer"
          ? { text: textInput || "Gratulerer med dagen", size: d.widthPx * 0.06, top: 0.25 }
          : { text: textInput || "Tekst", size: d.widthPx * 0.07, top: 0.5 };
    const txt = new fabric.Textbox(conf.text, {
      width: d.widthPx * 0.8,
      left: d.widthPx / 2,
      top: d.heightPx * conf.top,
      originX: "center",
      originY: "center",
      textAlign: "center",
      fontFamily,
      fontSize: conf.size,
      fill: "#1f1b16",
    });
    c.add(txt);
    c.setActiveObject(txt);
    c.requestRenderAll();
    setTextInput("");
    setActiveObj(txt);
  };

  const addClipart = async (cid: string) => {
    const c = fabRef.current;
    if (!c) return;
    const dataUrl = "data:image/svg+xml;utf8," + encodeURIComponent(iconSvg(cid));
    const img = await fabric.FabricImage.fromURL(dataUrl);
    const d = dimsRef.current;
    img.scaleToWidth(d.widthPx * 0.2);
    img.set({
      left: d.widthPx / 2,
      top: d.heightPx / 2,
      originX: "center",
      originY: "center",
    });
    c.add(img);
    c.setActiveObject(img);
    c.requestRenderAll();
  };

  const addImageFromFile = async (file: File) => {
    const c = fabRef.current;
    if (!c) return;
    setLoadingSource(true);
    setSourceError(null);
    try {
      const src = await loadCakeSource(file, file.name);
      const img = await fabric.FabricImage.fromURL(src.url, {
        crossOrigin: "anonymous",
      });
      const d = dimsRef.current;
      img.scaleToWidth(d.widthPx * 0.6);
      img.set({
        left: d.widthPx / 2,
        top: d.heightPx / 2,
        originX: "center",
        originY: "center",
      });
      c.add(img);
      c.setActiveObject(img);
      c.requestRenderAll();
      if (src.downscaled) {
        toast.message("Bildet ble skalert ned", {
          description: "Store filer skaleres til 5000 px så nettbrettet klarer dem.",
        });
      }
    } catch (e) {
      console.error("[CakeImageEditor] filen kunne ikke åpnes", e);
      setSourceError(
        "Denne filen kunne ikke åpnes. Prøv en JPG eller PNG — HEIC fra iPhone konverteres normalt automatisk.",
      );
    } finally {
      setLoadingSource(false);
    }
  };

  const deleteActive = useCallback(() => {
    const c = fabRef.current;
    const obj = c?.getActiveObject();
    if (!c || !obj) return;
    c.remove(obj);
    c.discardActiveObject();
    c.requestRenderAll();
    setActiveObj(null);
  }, []);

  const duplicateActive = useCallback(async () => {
    const c = fabRef.current;
    const obj = c?.getActiveObject();
    if (!c || !obj) return;
    const clone = await obj.clone(CANVAS_JSON_PROPS);
    clone.set({ left: (obj.left ?? 0) + 30, top: (obj.top ?? 0) + 30 });
    c.add(clone);
    c.setActiveObject(clone);
    c.requestRenderAll();
  }, []);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const c = fabRef.current;
      const obj = c?.getActiveObject();
      if (!c || !obj) return;
      obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy });
      obj.setCoords();
      c.requestRenderAll();
      snapshot();
    },
    [snapshot],
  );

  const restore = useCallback(
    async (json: string) => {
      const c = fabRef.current;
      if (!c) return;
      skipSnapshotRef.current = true;
      await c.loadFromJSON(JSON.parse(json));
      c.requestRenderAll();
      setLayers([...c.getObjects()]);
      setActiveObj(null);
      skipSnapshotRef.current = false;
      setSelVersion((v) => v + 1);
      refreshStacks();
    },
    [refreshStacks],
  );

  const undo = useCallback(async () => {
    if (undoStack.current.length <= 1) return;
    const cur = undoStack.current.pop()!;
    redoStack.current.push(cur);
    await restore(undoStack.current[undoStack.current.length - 1]);
    setDirty(true);
  }, [restore]);

  const redo = useCallback(async () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(next);
    await restore(next);
    setDirty(true);
  }, [restore]);

  const layerAction = (obj: fabric.Object, action: CakeLayerAction) => {
    const c = fabRef.current;
    if (!c) return;
    switch (action) {
      case "up":
        c.bringObjectForward(obj);
        break;
      case "down":
        c.sendObjectBackwards(obj);
        break;
      case "visible":
        obj.set("visible", obj.visible === false);
        break;
      case "lock":
        obj.set({
          selectable: obj.selectable === false,
          evented: obj.selectable === false,
        });
        break;
      case "delete":
        c.remove(obj);
        break;
    }
    c.requestRenderAll();
    setLayers([...c.getObjects()]);
    snapshot();
  };

  // ---- Eksport ----
  const exportCanvasElement = () => {
    const c = fabRef.current!;
    const d = dimsRef.current;
    const vpt = [...c.viewportTransform] as fabric.TMat2D;
    exportingRef.current = true;
    c.viewportTransform = [1, 0, 0, 1, 0, 0];
    try {
      return c.toCanvasElement(1, { width: d.widthPx, height: d.heightPx });
    } finally {
      c.viewportTransform = vpt;
      exportingRef.current = false;
      c.requestRenderAll();
    }
  };

  const renderPng = (): Promise<Blob> => {
    const el = exportCanvasElement();
    return new Promise((resolve, reject) => {
      el.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("Bildet kunne ikke lages"));
      }, "image/png");
    });
  };

  const renderDataUrl = () => exportCanvasElement().toDataURL("image/png");

  // ---- Kvalitet, lagring og utskrift ----
  const effectiveDpi = computeEffectiveDpi(
    image?.source_width_px ?? null,
    image?.source_height_px ?? null,
    format,
  );
  const qualityFlag = qualityFlagFor(effectiveDpi);
  const needsQualityAck = qualityFlag === "lav" && !qualityAcked;
  const rightsAnswered = rightsCleared || rightsNote.trim().length > 0;
  const canMarkFerdig = !needsQualityAck && rightsAnswered && !!format;

  const doSave = async (
    markFerdig = false,
    opts: { navigateBack?: boolean } = {},
  ): Promise<boolean> => {
    if (!image || !fabRef.current) return false;
    if (markFerdig && !canMarkFerdig) {
      toast.error(
        !format
          ? "Velg format før bildet markeres ferdig — uten format kan det ikke skrives ut i riktig størrelse"
          : needsQualityAck
            ? "Bekreft at bildet skal trykkes selv om oppløsningen er lav"
            : "Ta stilling til rettighetene før bildet markeres ferdig",
      );
      return false;
    }
    setSaving(true);
    try {
      const blob = await renderPng();
      const editedPath = await uploadEditedPng(blob, image.delivery_date);
      const { previousEditedPath } = await updateCakeImageGuarded(
        image.id,
        image.updated_at,
        {
          edited_path: editedPath,
          editor_state: JSON.parse(canvasSnapshot(fabRef.current)) as never,
          editor_state_version: EDITOR_STATE_VERSION,
          status: markFerdig ? "ferdig_redigert" : image.status,
          format_id: format?.id ?? image.format_id ?? null,
          shape: format?.shape ?? image.shape ?? null,
          width_mm: format ? formatDims(format).widthMm : (image.width_mm ?? null),
          height_mm: format ? formatDims(format).heightMm : (image.height_mm ?? null),
          effective_dpi: effectiveDpi,
          quality_flag: qualityFlag,
          rights_cleared: rightsCleared,
          rights_note: rightsNote.trim() || null,
          title: title.trim() || image.title,
        },
      );
      if (previousEditedPath && previousEditedPath !== editedPath) {
        await supabase.storage.from(CAKE_BUCKET).remove([previousEditedPath]);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["cake-images"] }),
        qc.invalidateQueries({ queryKey: ["cake-image", image.id] }),
      ]);
      setDirty(false);
      try {
        window.localStorage.removeItem(draftKey(image.id));
      } catch {
        // ingen konsekvens for brukeren
      }
      toast.success(markFerdig ? "Lagret og markert som ferdig redigert" : "Lagret");
      if (opts.navigateBack) {
        navigate(
          `/ordre/kakebilder/liste?date=${image.delivery_date}&status=for-utskrift`,
        );
      }
      return true;
    } catch (e) {
      if (e instanceof CakeImageConflictError) {
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
  const saveRef = useRef(doSave);
  saveRef.current = doSave;

  const saveTitle = async () => {
    if (!image) return;
    const next = title.trim();
    if (!next || next === image.title) return;
    await updateCakeImage(image.id, { title: next });
    qc.invalidateQueries({ queryKey: ["cake-image", image.id] });
    qc.invalidateQueries({ queryKey: ["cake-images"] });
  };

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

  /** Samme innhold på arket som fra listen: ark, utfall, etikettnummer og linjetekst. */
  const buildItem = async (dataUrl: string): Promise<CakePrintItem> => {
    let productName: string | null = null;
    let cakeText: string | null = null;
    if (image?.order_line_id) {
      try {
        const details = await fetchCakeLineDetails([image.order_line_id]);
        const d = details[image.order_line_id];
        productName = d?.productName ?? null;
        cakeText = d?.cakeText ?? null;
      } catch (e) {
        console.error("[CakeImageEditor] kunne ikke hente linjeteksten", e);
      }
    }
    return {
      image: image ?? null,
      url: dataUrl,
      widthMm: dims.widthMm,
      heightMm: dims.heightMm,
      isRound: dims.isRound,
      labelNumber: image
        ? ((await withResolvedLabelNumbers([image]))[0]?.resolved_label_number ?? null)
        : null,

      sheet: format?.sheet ?? "A4",
      bleedMm: format?.bleed_mm ?? 0,
      productName,
      cakeText,
      orderRef: image?.order_ref ?? null,
      customerName: image?.customer_name ?? null,
      deliveryDate: image?.delivery_date ?? null,
      title: image?.title ?? null,
    };
  };

  /**
   * Samme sperre som listen bruker, men med editorens gjeldende tilstand:
   * valgt format, bekreftet lav oppløsning og avklarte rettigheter. Kjøres
   * FØR lagring, slik at et bilde uten format aldri kan bli et «MANGLER
   * FORMAT»-ark som bekreftes som skrevet ut.
   */
  const checkPrintGate = (): boolean => {
    if (!image) return false;
    const gate = evaluatePrintGate({
      format_id: format?.id ?? null,
      width_mm: dims.widthMm ?? null,
      height_mm: dims.heightMm ?? null,
      quality_flag: needsQualityAck ? "lav" : "god",
      quality_ack_at: needsQualityAck ? null : new Date().toISOString(),
      rights_cleared: rightsAnswered,
      rights_note: rightsNote,
    });
    if (!gate.ok) {
      toast.error("Kan ikke skrives ut ennå", { description: gate.reason });
      return false;
    }
    return true;
  };

  const printNow = async () => {

    if (!image) return;
    try {
      const item = await buildItem(renderDataUrl());
      await printFlow.printItems([item], { [image.id]: image.status });
    } catch (e) {
      showError(
        "CakeImageEditor.print",
        e,
        "Kunne ikke skrive ut. Prøv igjen — kontakt support hvis det gjentar seg.",
      );
    }
  };

  const downloadPdf = async () => {
    const dataUrl = renderDataUrl();
    const safeName =
      (image?.title ?? "kakebilde").replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 80) ||
      "kakebilde";
    const res = await cakeSheetsToPdf([await buildItem(dataUrl)], {
      scale: printScale,
      scaleY: printScaleY,
      printerLabel,
      fileName: `${safeName}.pdf`,
    });
    if (image) {
      await markPrinted([image.id], "pdf", res.sheet, null, {
        printerLabel,
        scaleAppliedPct: printScalePct,
      });
      qc.invalidateQueries({ queryKey: ["cake-image-prints", image.id] });
    }
  };

  // ---- Hurtigtaster ----
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable ||
        !!el.closest?.("[role='dialog']")
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = true;
      const c = fabRef.current;
      if (!c || isTyping(e.target)) return;
      const editing = c
        .getObjects()
        .some((o) => (o as fabric.Textbox).isEditing === true);
      if (editing) return;
      const meta = e.metaKey || e.ctrlKey;
      const step = e.shiftKey ? 10 : 1;

      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void redo();
        return;
      }
      if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        void duplicateActive();
        return;
      }
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current(false);
        return;
      }
      if (meta) return;

      switch (e.key) {
        case "Delete":
        case "Backspace":
          e.preventDefault();
          deleteActive();
          break;
        case "ArrowLeft":
          e.preventDefault();
          nudge(-step, 0);
          break;
        case "ArrowRight":
          e.preventDefault();
          nudge(step, 0);
          break;
        case "ArrowUp":
          e.preventDefault();
          nudge(0, -step);
          break;
        case "ArrowDown":
          e.preventDefault();
          nudge(0, step);
          break;
        case "Escape":
          c.discardActiveObject();
          c.requestRenderAll();
          setActiveObj(null);
          break;
        case "+":
        case "=":
          applyZoom(c.getZoom() * 1.15);
          break;
        case "-":
          applyZoom(c.getZoom() / 1.15);
          break;
        case "0":
          fitToView();
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [undo, redo, duplicateActive, deleteActive, nudge, applyZoom, fitToView]);

  const ppm = pxPerMm(dims.widthPx, dims.widthMm);
  const isTextActive =
    activeObj instanceof fabric.Textbox || activeObj instanceof fabric.IText;

  // ---- Paneler ----
  const leftPanel = (
    <Accordion type="multiple" defaultValue={["mal", "tekst", "bilde"]}>
      <AccordionItem value="mal">
        <AccordionTrigger className="text-sm">Format og størrelse</AccordionTrigger>
        <AccordionContent>
          <div className="grid grid-cols-2 gap-2">
            {formats.map((f) => {
              const d = formatDims(f);
              return (
                <button
                  key={f.id}
                  onClick={() => setFormatId(f.id)}
                  className={cn(
                    "min-h-10 rounded-md border p-2 text-left text-xs hover:bg-accent",
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
                    {d.isRound ? `Ø ${d.widthMm} mm` : `${d.widthMm} × ${d.heightMm} mm`}
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
              {dims.bleedMm} mm utfallende sone rundt kanten klippes bort — la bildet
              gå helt ut, ellers blir det hvit rand.
            </p>
          )}
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="kvalitet">
        <AccordionTrigger className="text-sm">Kvalitet og rettigheter</AccordionTrigger>
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
              <span>Jeg har sett oppløsningen og vil trykke bildet likevel.</span>
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
        <AccordionContent className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void addImageFromFile(f);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <Button
            variant="outline"
            className="h-10 w-full"
            onClick={() => fileInputRef.current?.click()}
            disabled={loadingSource}
          >
            {loadingSource ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="mr-2 h-4 w-4" />
            )}
            Legg til bilde-lag
          </Button>
          {sourceError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {sourceError}
            </p>
          )}
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="tekst">
        <AccordionTrigger className="text-sm">Tekst</AccordionTrigger>
        <AccordionContent className="space-y-2">
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
            className="h-10"
          />
          <div className="grid gap-1">
            {TEXT_TEMPLATES.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={t.id === "fritekst" ? "default" : "outline"}
                className="h-10 justify-start"
                onClick={() => void addTemplateText(t.id)}
              >
                <TypeIcon className="mr-2 h-4 w-4" />
                {t.label}
              </Button>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="clipart">
        <AccordionTrigger className="text-sm">Clipart</AccordionTrigger>
        <AccordionContent>
          <div className="grid grid-cols-3 gap-2">
            {CLIPART.map((c) => (
              <button
                key={c.id}
                onClick={() => void addClipart(c.id)}
                className="flex aspect-square min-h-10 flex-col items-center justify-center rounded-md border bg-muted text-xs hover:bg-accent"
              >
                <c.Icon className="mb-1 h-6 w-6" />
                {c.label}
              </button>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );

  const rightPanel = image ? (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Tittel</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-10"
        />
      </div>
      <div>
        <Label className="text-xs">Kunde</Label>
        <Input
          defaultValue={image.customer_name ?? ""}
          onBlur={(e) =>
            updateCakeImage(image.id, { customer_name: e.target.value || null })
          }
          className="h-10"
        />
      </div>

      <Separator />

      <div className="flex items-center gap-2 text-sm font-semibold">
        <LayersIcon className="h-4 w-4" />
        Lag
      </div>
      <CakeLayerList
        layers={layers}
        active={activeObj}
        onSelect={(o) => {
          fabRef.current?.setActiveObject(o);
          fabRef.current?.requestRenderAll();
          setActiveObj(o);
        }}
        onAction={layerAction}
      />

      <Separator />

      {isTextActive && (
        <CakeTextPanel
          obj={activeObj as CakeCurvedText}
          onLive={live}
          onCommit={snapshot}
        />
      )}

      {activeObj instanceof fabric.FabricImage && (
        <CakeImageLayerPanel
          obj={activeObj}
          boxW={dims.widthPx}
          boxH={dims.heightPx}
          pxPerMmValue={ppm}
          onLive={live}
          onCommit={snapshot}
        />
      )}

      <Separator />

      <div className="space-y-1 text-xs text-muted-foreground">
        <div>Status: {image.status}</div>
        <div>Skrevet ut: {image.print_count}×</div>
        <CakePrintHistory cakeImageId={image.id} />
      </div>
    </div>
  ) : null;

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
      <div className="flex flex-wrap items-center gap-1 border-b bg-card px-3 py-2">
        <Button
          variant="ghost"
          className="h-10"
          onClick={() => guard.requestAction(() => navigate(-1))}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Tilbake
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <Button
          variant="ghost"
          className="h-10 w-10 p-0"
          aria-label="Angre"
          disabled={!canUndo}
          onClick={() => void undo()}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          className="h-10 w-10 p-0"
          aria-label="Gjør om"
          disabled={!canRedo}
          onClick={() => void redo()}
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          className="h-10 w-10 p-0"
          aria-label="Slett valgt lag"
          onClick={deleteActive}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        {dirty && (
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            Ulagrede endringer
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            className="h-10 w-10 p-0"
            aria-label="Zoom ut"
            onClick={() => applyZoom(zoom / 1.15)}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            className="h-10 w-10 p-0"
            aria-label="Zoom inn"
            onClick={() => applyZoom(zoom * 1.15)}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            className="h-10 w-10 p-0"
            aria-label="Tilpass visningen"
            onClick={fitToView}
          >
            <Maximize className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "grid flex-1 min-h-0",
          compact ? "grid-cols-1" : "grid-cols-[280px_1fr_320px]",
        )}
      >
        {!compact && (
          <aside className="overflow-y-auto border-r bg-background p-3">{leftPanel}</aside>
        )}

        {/* Lerret */}
        <div className="relative min-h-0 overflow-hidden bg-[hsl(var(--muted))]">
          {(stateLoadFailed || sourceError) && (
            <div className="absolute inset-x-3 top-3 z-10 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">
                {sourceError ??
                  "Den lagrede redigeringen kunne ikke åpnes. Originalbildet vises i stedet — ingenting er slettet."}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setStateLoadFailed(false);
                  setSourceError(null);
                }}
              >
                Lukk
              </Button>
            </div>
          )}
          <div ref={viewRef} className="h-full w-full touch-none">
            <canvas ref={canvasRef} />
          </div>
          {loadingSource && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        {!compact && (
          <aside className="overflow-y-auto border-l bg-background p-3">{rightPanel}</aside>
        )}
      </div>

      {/* Bunn-bar */}
      <div className="flex flex-wrap items-center gap-2 border-t bg-card px-3 py-2">
        {compact && (
          <>
            <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-10">
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Verktøy
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[320px] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Verktøy</SheetTitle>
                </SheetHeader>
                <div className="mt-3">{leftPanel}</div>
              </SheetContent>
            </Sheet>
            <Sheet open={rightOpen} onOpenChange={setRightOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-10">
                  <LayersIcon className="mr-2 h-4 w-4" />
                  Lag
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[340px] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Lag og detaljer</SheetTitle>
                </SheetHeader>
                <div className="mt-3">{rightPanel}</div>
              </SheetContent>
            </Sheet>
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-10"
            onClick={() => doSave(false, { navigateBack: true })}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Lagre
          </Button>
          <Button
            variant="default"
            className="h-10"
            onClick={() => doSave(true, { navigateBack: true })}
            disabled={saving}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Lagre & marker ferdig
          </Button>
          <div className="flex flex-col items-start">
            <Button
              variant="brand"
              className="h-10"
              disabled={printFlow.busy || saving}
              onClick={async () => {
                if (await doSave(false)) void printNow();
              }}
            >
              {printFlow.busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Printer className="mr-2 h-4 w-4" />
              )}
              Skriv ut
            </Button>
            <span className="mt-0.5 text-[11px] text-muted-foreground">
              {printerLabel
                ? `${printerLabel} · ${
                    printerCalibrated
                      ? `korreksjon ${printScalePct} % × ${printScaleYPct} %`
                      : "ikke kalibrert (100 %)"
                  }`
                : "Velg skriver i utskriftsvisningen"}
            </span>
          </div>

          <Button
            variant="outline"
            className="h-10"
            onClick={async () => {
              if (await doSave(false)) void downloadPdf();
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      {printFlow.dialog}

      <UnsavedChangesDialog
        {...guard.dialogProps}
        description="Kakebildet har endringer som ikke er lagret. Fortsetter du, forsvinner de."
      />


      <AlertDialog
        open={!!draftPrompt}
        onOpenChange={(v) => {
          if (!v) setDraftPrompt(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gjenopprett utkast?</AlertDialogTitle>
            <AlertDialogDescription>
              Det ligger et nyere utkast av dette kakebildet i nettleseren. Vil du
              hente det tilbake?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (image) {
                  try {
                    window.localStorage.removeItem(draftKey(image.id));
                  } catch {
                    // ingen konsekvens
                  }
                }
                setDraftPrompt(null);
              }}
            >
              Forkast utkastet
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void restoreDraft()}>
              Gjenopprett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <span hidden>{selVersion}</span>
    </div>
  );
}

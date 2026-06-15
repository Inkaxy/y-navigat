import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GripVertical, Minus, MoreHorizontal, Palette, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { TemplatesDialog } from "@/pos_styring/components/TemplatesDialog";
import { ThemeSettingsDialog } from "@/pos_styring/components/ThemeSettingsDialog";
import { KioskRender } from "@/kiosk/render/KioskRender";
import { parseTheme } from "@/kiosk/render/kioskTheme";

interface KeypadLayoutDetail {
  id: string;
  legal_entity_id: string;
  display_name: string;
  grid_cols: number;
  grid_rows: number;
  terminal_id: string | null;
  is_default: boolean;
  show_product_image: boolean;
  theme: unknown;
  customer_screen: unknown;
}

interface KeypadPage {
  id: string;
  page_name: string;
  sort_order: number;
  background_color: string | null;
}

type ButtonType = "product" | "category" | "function";

interface KeypadButton {
  id: string;
  page_id: string;
  button_type: ButtonType;
  product_id: string | null;
  function_code: string | null;
  display_label: string | null;
  image_url: string | null;
  image_storage_path: string | null;
  show_image: boolean | null;
  background_color: string | null;
  text_color: string | null;
  grid_x: number;
  grid_y: number;
  grid_width: number;
  grid_height: number;
  target_page_id: string | null;
  product?: { display_name: string; product_category: string | null; in_pos: boolean } | null;
}

interface ProductOption {
  id: string;
  display_name: string;
  product_category: string | null;
}

const PRODUCT_IMAGE_BUCKET = "pos-product-images";
const keypadSignedUrlCache = new Map<string, { url: string; expiresAt: number }>();

const COLOR_OPTIONS = [
  { label: "Standard", background: "", text: "" },
  { label: "App", background: "#F97316", text: "#FFFFFF" },
  { label: "Grønn", background: "#22C55E", text: "#FFFFFF" },
  { label: "Gul", background: "#FACC15", text: "#111827" },
  { label: "Blå", background: "#3B82F6", text: "#FFFFFF" },
  { label: "Rosa", background: "#EC4899", text: "#FFFFFF" },
];

const FUNCTIONS = [
  { code: "discount", label: "Rabatt" },
  { code: "void_last", label: "Annuller siste linje" },
  { code: "open_drawer", label: "Åpne kasseskuff" },
  { code: "price_override", label: "Overstyr pris" },
  { code: "customer_lookup", label: "Søk kunde" },
  { code: "kakebygger", label: "Kakebygger" },
  { code: "henteordre", label: "Henteordre" },
];

const buttonSchema = z.object({
  button_type: z.enum(["product", "category", "function"]),
  product_id: z.string().optional(),
  function_code: z.string().optional(),
  target_page_id: z.string().optional(),
  display_label: z.string().trim().optional(),
  image_url: z.string().trim().optional(),
  image_storage_path: z.string().trim().optional(),
  show_image: z.enum(["inherit", "on", "off"]),
  background_color: z.string().trim().optional(),
  text_color: z.string().trim().optional(),
  grid_width: z.coerce.number().int().min(1, "Minst 1").max(12, "For stor"),
  grid_height: z.coerce.number().int().min(1, "Minst 1").max(10, "For stor"),
}).superRefine((values, ctx) => {
  if (values.button_type === "product" && !values.product_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["product_id"], message: "Velg produkt" });
  }
  if (values.button_type === "function" && !values.function_code) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["function_code"], message: "Velg funksjon" });
  }
  if (values.button_type === "category" && !values.display_label?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["display_label"], message: "Kategori trenger label" });
  }
});

type ButtonFormValues = z.infer<typeof buttonSchema>;

function showImageToBoolNullable(v: "inherit" | "on" | "off"): boolean | null {
  if (v === "on") return true;
  if (v === "off") return false;
  return null;
}
function showImageFromDb(v: boolean | null | undefined): "inherit" | "on" | "off" {
  if (v === true) return "on";
  if (v === false) return "off";
  return "inherit";
}

function normalizeOptional(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buttonLabel(button: KeypadButton) {
  return button.display_label || button.product?.display_name || FUNCTIONS.find((item) => item.code === button.function_code)?.label || button.function_code || "Knapp";
}

function overlaps(a: { grid_x: number; grid_y: number; grid_width: number; grid_height: number }, b: { grid_x: number; grid_y: number; grid_width: number; grid_height: number }) {
  return a.grid_x < b.grid_x + b.grid_width && a.grid_x + a.grid_width > b.grid_x && a.grid_y < b.grid_y + b.grid_height && a.grid_y + a.grid_height > b.grid_y;
}

function hasCollision(candidate: { grid_x: number; grid_y: number; grid_width: number; grid_height: number }, buttons: KeypadButton[], ignoreId?: string) {
  return buttons.some((button) => button.id !== ignoreId && overlaps(candidate, button));
}

async function fetchLayout(layoutId: string): Promise<KeypadLayoutDetail> {
  const { data, error } = await supabase
    .from("pos_keypad_layouts")
    .select("id, legal_entity_id, display_name, grid_cols, grid_rows, terminal_id, is_default, show_product_image, theme, customer_screen")
    .eq("id", layoutId)
    .single();
  if (error) throw error;
  return data as unknown as KeypadLayoutDetail;
}

async function fetchPages(layoutId: string): Promise<KeypadPage[]> {
  const { data, error } = await supabase
    .from("pos_keypad_pages")
    .select("id, page_name, sort_order, background_color")
    .eq("layout_id", layoutId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as KeypadPage[];
}

async function fetchButtons(pageId: string): Promise<KeypadButton[]> {
  const { data, error } = await supabase
    .from("pos_keypad_buttons")
    .select("id, page_id, button_type, product_id, function_code, display_label, image_url, image_storage_path, show_image, background_color, text_color, grid_x, grid_y, grid_width, grid_height, target_page_id, product:products!pos_keypad_buttons_product_id_fkey(display_name, product_category, in_pos)")
    .eq("page_id", pageId);
  if (error) throw error;
  return (data ?? []) as unknown as KeypadButton[];
}

async function fetchProducts(activeEntityId: string, search: string): Promise<ProductOption[]> {
  let query = supabase
    .from("products")
    .select("id, display_name, product_category")
    .eq("legal_entity_id", activeEntityId)
    .eq("in_pos", true)
    .in("status", ["active", "published"])
    .order("display_name", { ascending: true })
    .limit(30);
  if (search.trim()) query = query.ilike("display_name", `%${search.trim()}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProductOption[];
}

async function getKeypadSignedUrl(storagePath: string | null) {
  if (!storagePath) return "";
  const cached = keypadSignedUrlCache.get(storagePath);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).createSignedUrl(storagePath, 3600);
  if (error) throw error;
  keypadSignedUrlCache.set(storagePath, { url: data.signedUrl, expiresAt: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

async function fetchPrimaryProductImagePath(productId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("pos_product_images")
    .select("storage_path")
    .eq("product_id", productId)
    .eq("is_primary", true)
    .maybeSingle();
  if (error) throw error;
  return data?.storage_path ?? null;
}

function DroppableCell({ x, y, children }: { x: number; y: number; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell-${x}-${y}`, data: { x, y } });
  return (
    <div ref={setNodeRef} className={cn("rounded-md border border-dashed border-border bg-background/70 transition-colors", isOver && "border-primary bg-primary/10")}>
      {children}
    </div>
  );
}

function KeypadButtonTile({ button, layout, onEdit, dragging, onResize }: { button: KeypadButton; layout?: KeypadLayoutDetail; onEdit?: () => void; dragging?: boolean; onResize?: (w: number, h: number) => void }) {
  const notInPos = button.button_type === "product" && button.product && button.product.in_pos === false;
  const showImage = button.show_image ?? layout?.show_product_image ?? true;

  const { data: productPrimaryPath = null } = useQuery({
    queryKey: ["pos_product_primary_image_path", button.product_id],
    queryFn: () => fetchPrimaryProductImagePath(button.product_id!),
    enabled: showImage && button.button_type === "product" && !!button.product_id && !button.image_storage_path && !button.image_url,
    staleTime: 50 * 60 * 1000,
  });

  const { data: functionImagePath = null } = useQuery({
    queryKey: ["pos_function_image_path", layout?.legal_entity_id, button.function_code],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_function_images")
        .select("storage_path")
        .eq("legal_entity_id", layout!.legal_entity_id)
        .eq("function_code", button.function_code!)
        .maybeSingle();
      if (error) return null;
      return data?.storage_path ?? null;
    },
    enabled:
      showImage &&
      button.button_type === "function" &&
      !!button.function_code &&
      !!layout?.legal_entity_id &&
      !button.image_storage_path &&
      !button.image_url,
    staleTime: 50 * 60 * 1000,
  });

  const effectivePath = button.image_storage_path || productPrimaryPath || functionImagePath;

  const { data: signedFromPath = "" } = useQuery({
    queryKey: ["pos_keypad_tile_url", effectivePath],
    queryFn: () => getKeypadSignedUrl(effectivePath),
    enabled: showImage && !!effectivePath,
    staleTime: 50 * 60 * 1000,
  });
  const bgImage = showImage ? (button.image_url || signedFromPath) : "";
  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn("relative flex h-full w-full overflow-hidden rounded-md border border-primary/20 bg-primary/15 p-2 text-left text-sm font-semibold shadow-card transition hover:ring-2 hover:ring-ring", dragging && "opacity-60", notInPos && "border-destructive/60 ring-1 ring-destructive/40")}
      style={{ backgroundColor: button.background_color ?? undefined, color: button.text_color ?? undefined }}
    >
      {bgImage && <span className="absolute inset-0 bg-cover bg-center opacity-60" style={{ backgroundImage: `url(${bgImage})` }} />}
      {notInPos && (
        <span className="absolute left-1 top-1 z-10 rounded-sm bg-destructive px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive-foreground" title="Produktet er ikke aktivert for POS">
          Ikke i POS
        </span>
      )}
      <span className="relative z-10 line-clamp-3 self-end rounded-sm bg-background/75 px-1.5 py-1 text-foreground">{buttonLabel(button)}</span>
      {onResize && !dragging && (
        <ResizeHandle button={button} onResize={onResize} />
      )}
    </button>
  );
}

function ResizeHandle({ button, onResize }: { button: KeypadButton; onResize: (w: number, h: number) => void }) {
  const stateRef = useRef<{ w: number; h: number } | null>(null);
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const tileEl = (e.currentTarget.parentElement as HTMLElement | null);
    if (!tileEl) return;
    const rect = tileEl.getBoundingClientRect();
    const cellW = rect.width / Math.max(1, button.grid_width);
    const cellH = rect.height / Math.max(1, button.grid_height);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = button.grid_width;
    const startH = button.grid_height;
    stateRef.current = { w: startW, h: startH };
    const onMove = (ev: PointerEvent) => {
      const dw = Math.round((ev.clientX - startX) / cellW);
      const dh = Math.round((ev.clientY - startY) / cellH);
      stateRef.current = { w: Math.max(1, startW + dw), h: Math.max(1, startH + dh) };
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const s = stateRef.current;
      if (s && (s.w !== startW || s.h !== startH)) onResize(s.w, s.h);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return (
    <div
      onPointerDown={handlePointerDown}
      role="presentation"
      title="Dra for å endre størrelse"
      className="absolute bottom-0 right-0 z-20 flex h-4 w-4 cursor-se-resize items-end justify-end"
    >
      <span className="block h-2.5 w-2.5 rounded-tl-sm bg-primary/70 ring-1 ring-background" />
    </div>
  );
}

interface ButtonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: string;
  layout: KeypadLayoutDetail;
  buttons: KeypadButton[];
  pages: KeypadPage[];
  cell: { x: number; y: number } | null;
  button: KeypadButton | null;
  activeEntityId: string;
}

function ButtonDialog({ open, onOpenChange, pageId, layout, buttons, pages, cell, button, activeEntityId }: ButtonDialogProps) {
  const queryClient = useQueryClient();
  const [productSearch, setProductSearch] = useState("");
  const isEdit = !!button;
  const origin = button ? { x: button.grid_x, y: button.grid_y } : cell ?? { x: 0, y: 0 };

  const form = useForm<ButtonFormValues>({
    resolver: zodResolver(buttonSchema),
    defaultValues: {
      button_type: "product",
      product_id: "",
      function_code: "discount",
      target_page_id: "",
      display_label: "",
      image_url: "",
      image_storage_path: "",
      show_image: "inherit",
      background_color: "",
      text_color: "",
      grid_width: 1,
      grid_height: 1,
    },
  });

  const buttonType = form.watch("button_type");
  const selectedProductId = form.watch("product_id");
  const imageUrl = form.watch("image_url");
  const imageStoragePath = form.watch("image_storage_path");
  const showImageMode = form.watch("show_image");
  const effectiveShowImage =
    showImageMode === "on" ? true : showImageMode === "off" ? false : layout.show_product_image;

  useEffect(() => {
    if (!open) return;
    form.reset({
      button_type: button?.button_type ?? "product",
      product_id: button?.product_id ?? "",
      function_code: button?.function_code ?? "discount",
      target_page_id: button?.target_page_id ?? "",
      display_label: button?.display_label ?? "",
      image_url: button?.image_url ?? "",
      image_storage_path: button?.image_storage_path ?? "",
      show_image: showImageFromDb(button?.show_image ?? null),
      background_color: button?.background_color ?? "",
      text_color: button?.text_color ?? "",
      grid_width: button?.grid_width ?? 1,
      grid_height: button?.grid_height ?? 1,
    });
    setProductSearch("");
  }, [button, form, open]);

  const { data: products = [] } = useQuery({
    queryKey: ["pos_keypad_products", activeEntityId, productSearch],
    queryFn: () => fetchProducts(activeEntityId, productSearch),
    enabled: open && buttonType === "product" && !!activeEntityId,
  });

  const { data: primaryImagePath = null } = useQuery({
    queryKey: ["pos_product_primary_image_path", selectedProductId],
    queryFn: () => fetchPrimaryProductImagePath(selectedProductId!),
    enabled: open && buttonType === "product" && !!selectedProductId,
  });

  // Merk: vi setter IKKE image_storage_path automatisk fra produktets primærbilde lenger.
  // Kiosken plukker det opp automatisk basert på `pos_product_images.is_primary` så lenge
  // `show_image` (eller layoutens `show_product_image`) er på.

  // Sign preview URL for storage_path (own image OR product primary)
  const previewStoragePath = imageStoragePath || (buttonType === "product" ? primaryImagePath ?? "" : "");
  const { data: previewSignedUrl = "" } = useQuery({
    queryKey: ["pos_keypad_preview_url", previewStoragePath],
    queryFn: () => getKeypadSignedUrl(previewStoragePath),
    enabled: open && !!previewStoragePath,
  });
  const effectivePreviewUrl = imageUrl || previewSignedUrl;


  const saveMutation = useMutation({
    mutationFn: async (values: ButtonFormValues) => {
      const candidate = {
        grid_x: origin.x,
        grid_y: origin.y,
        grid_width: values.grid_width,
        grid_height: values.grid_height,
      };
      if (candidate.grid_x + candidate.grid_width > layout.grid_cols || candidate.grid_y + candidate.grid_height > layout.grid_rows) {
        throw new Error("Knappen går utenfor gridet");
      }
      if (hasCollision(candidate, buttons, button?.id)) {
        throw new Error("Kollisjon med annen knapp");
      }

      const payload = {
        page_id: pageId,
        button_type: values.button_type,
        product_id: values.button_type === "product" ? normalizeOptional(values.product_id) : null,
        function_code: values.button_type === "function" ? normalizeOptional(values.function_code) : null,
        target_page_id: values.button_type === "category" ? normalizeOptional(values.target_page_id) : null,
        display_label: normalizeOptional(values.display_label),
        image_url: normalizeOptional(values.image_url),
        image_storage_path: normalizeOptional(values.image_storage_path),
        show_image: showImageToBoolNullable(values.show_image),
        background_color: normalizeOptional(values.background_color),
        text_color: normalizeOptional(values.text_color),
        ...candidate,
      };

      if (isEdit) {
        const { error } = await supabase.from("pos_keypad_buttons").update(payload).eq("id", button.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("pos_keypad_buttons").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_buttons", pageId] });
      toast.success("Knapp lagret");
      onOpenChange(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Kunne ikke lagre knapp"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!button) return;
      const { error } = await supabase.from("pos_keypad_buttons").delete().eq("id", button.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_buttons", pageId] });
      toast.success("Knapp slettet");
      onOpenChange(false);
    },
    onError: (error) => toast.error("Kunne ikke slette knapp", { description: error instanceof Error ? error.message : "Ukjent feil" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rediger knapp" : "Ny knapp"}</DialogTitle>
          <DialogDescription>Plassering: kolonne {origin.x + 1}, rad {origin.y + 1}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="space-y-4">
            <FormField control={form.control} name="button_type" render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <FormControl>
                  <RadioGroup value={field.value} onValueChange={field.onChange} className="grid grid-cols-3 gap-2">
                    {[
                      ["product", "Produkt"],
                      ["category", "Kategori"],
                      ["function", "Funksjon"],
                    ].map(([value, label]) => (
                      <label key={value} className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
                        <RadioGroupItem value={value} /> {label}
                      </label>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {buttonType === "product" && (
              <FormField control={form.control} name="product_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Produkt</FormLabel>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Søk produkt" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} />
                  </div>
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Velg produkt" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>{product.display_name}{product.product_category ? ` — ${product.product_category}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            {buttonType === "function" && (
              <FormField control={form.control} name="function_code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Funksjon</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {FUNCTIONS.map((item) => <SelectItem key={item.code} value={item.code}>{item.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            {buttonType === "category" && (
              <FormField control={form.control} name="target_page_id" render={({ field }) => {
                const selectablePages = pages.filter((p) => p.id !== pageId);
                return (
                  <FormItem>
                    <FormLabel>Underside</FormLabel>
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder={selectablePages.length ? "Velg side å navigere til" : "Ingen andre sider tilgjengelig"} /></SelectTrigger></FormControl>
                      <SelectContent>
                        {selectablePages.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.page_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Kategori-knappen åpner valgt underside i kiosken. Uten valg får operatøren en advarsel.
                    </p>
                    <FormMessage />
                  </FormItem>
                );
              }} />
            )}


            <div className="grid gap-3 sm:grid-cols-2">
              <FormField control={form.control} name="display_label" render={({ field }) => (
                <FormItem>
                  <FormLabel>Label</FormLabel>
                  <FormControl><Input {...field} placeholder={buttonType === "category" ? "Kategori-navn" : "Valgfri override"} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="image_url" render={({ field }) => (
                <FormItem>
                  <FormLabel>Bilde-URL (overstyring)</FormLabel>
                  <FormControl><Input {...field} placeholder="https://… (valgfri, overstyrer produktbilde)" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="show_image" render={({ field }) => (
              <FormItem className="rounded-md border bg-muted/40 p-3">
                <FormLabel>Bilde på knappen</FormLabel>
                <FormControl>
                  <RadioGroup value={field.value} onValueChange={field.onChange} className="grid grid-cols-3 gap-2">
                    {[
                      ["inherit", `Arv fra layout (${layout.show_product_image ? "på" : "av"})`],
                      ["on", "Alltid vis"],
                      ["off", "Skjul"],
                    ].map(([value, label]) => (
                      <label key={value} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs">
                        <RadioGroupItem value={value} /> {label}
                      </label>
                    ))}
                  </RadioGroup>
                </FormControl>
                {buttonType === "product" && (
                  <p className="text-xs text-muted-foreground">
                    {effectiveShowImage
                      ? primaryImagePath || imageStoragePath || imageUrl
                        ? "Knappen vil vise produktets primærbilde (eller egendefinert override)."
                        : "Ingen primærbilde lastet opp for dette produktet ennå — last opp under Varer (POS)."
                      : "Bilde er skjult for denne knappen."}
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )} />

            {effectivePreviewUrl && (
              <div className="overflow-hidden rounded-lg border bg-muted">
                <div className="relative aspect-[5/2]">
                  <img src={effectivePreviewUrl} alt="Forhåndsvisning av knappbilde" className="h-full w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-background/80 p-2 text-sm font-medium text-foreground">
                    {imageUrl ? "Egendefinert bilde-URL" : "Primærbilde fra produkt"}
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField control={form.control} name="background_color" render={({ field }) => (
                <FormItem>
                  <FormLabel>Bakgrunn</FormLabel>
                  <div className="flex gap-2">
                    <FormControl><Input {...field} placeholder="#F97316" /></FormControl>
                    <Input type="color" className="h-10 w-14 p-1" value={field.value || "#f97316"} onChange={field.onChange} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {COLOR_OPTIONS.map((color) => (
                      <button key={color.label} type="button" className="h-7 rounded-md border px-2 text-xs" style={{ backgroundColor: color.background || undefined, color: color.text || undefined }} onClick={() => { form.setValue("background_color", color.background); form.setValue("text_color", color.text); }}>{color.label}</button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="text_color" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tekst</FormLabel>
                  <div className="flex gap-2">
                    <FormControl><Input {...field} placeholder="#111827" /></FormControl>
                    <Input type="color" className="h-10 w-14 p-1" value={field.value || "#111827"} onChange={field.onChange} />
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="grid_width" render={({ field }) => (
                <FormItem>
                  <FormLabel>Bredde</FormLabel>
                  <FormControl><Input type="number" min={1} max={layout.grid_cols - origin.x} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="grid_height" render={({ field }) => (
                <FormItem>
                  <FormLabel>Høyde</FormLabel>
                  <FormControl><Input type="number" min={1} max={layout.grid_rows - origin.y} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              {isEdit ? <Button type="button" variant="destructive" onClick={() => deleteMutation.mutate()}><Trash2 className="h-4 w-4" /> Slett</Button> : <span />}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
                <Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? "Lagrer…" : "Lagre"}</Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function TastaturEditor() {
  const { id: layoutId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeEntityId, activeEntity } = useLegalEntity();
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [buttonDialogOpen, setButtonDialogOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [editingButton, setEditingButton] = useState<KeypadButton | null>(null);
  const [draggingButton, setDraggingButton] = useState<KeypadButton | null>(null);
  const [pageDialog, setPageDialog] = useState<{ mode: "create" | "rename" | "color"; page?: KeypadPage } | null>(null);
  const [pageName, setPageName] = useState("");
  const [pageColor, setPageColor] = useState("");
  const [deletePage, setDeletePage] = useState<KeypadPage | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const { data: layout, isLoading: layoutLoading, error: layoutError } = useQuery({
    queryKey: ["pos_keypad_layout", layoutId],
    queryFn: () => fetchLayout(layoutId!),
    enabled: !!layoutId,
  });

  const { data: pages = [], isLoading: pagesLoading } = useQuery({
    queryKey: ["pos_keypad_pages", layoutId],
    queryFn: () => fetchPages(layoutId!),
    enabled: !!layoutId,
  });

  useEffect(() => {
    if (!activePageId && pages.length > 0) setActivePageId(pages[0].id);
    if (activePageId && pages.length > 0 && !pages.some((page) => page.id === activePageId)) setActivePageId(pages[0].id);
  }, [activePageId, pages]);

  useEffect(() => {
    if (layout && activeEntityId && layout.legal_entity_id !== activeEntityId) {
      toast.warning(`Layout ikke tilgjengelig for ${activeEntity?.short_code ?? "valgt entity"}`);
      navigate("/pos-styring/tastatur", { replace: true });
    }
  }, [activeEntity?.short_code, activeEntityId, layout, navigate]);

  const { data: buttons = [], isLoading: buttonsLoading } = useQuery({
    queryKey: ["pos_keypad_buttons", activePageId],
    queryFn: () => fetchButtons(activePageId!),
    enabled: !!activePageId,
  });

  const activePage = pages.find((page) => page.id === activePageId) ?? null;

  const buttonByCell = useMemo(() => {
    const map = new Map<string, KeypadButton>();
    for (const button of buttons) {
      map.set(`${button.grid_x}-${button.grid_y}`, button);
    }
    return map;
  }, [buttons]);

  const toggleShowImagesMutation = useMutation({
    mutationFn: async (next: boolean) => {
      if (!layoutId) return;
      const { error } = await supabase
        .from("pos_keypad_layouts")
        .update({ show_product_image: next })
        .eq("id", layoutId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_layout", layoutId] });
      toast.success("Layout oppdatert");
    },
    onError: (error) => toast.error("Kunne ikke oppdatere layout", { description: error instanceof Error ? error.message : "Ukjent feil" }),
  });


  const pageMutation = useMutation({
    mutationFn: async () => {
      if (!layoutId || !pageDialog) return;
      if (pageDialog.mode === "create") {
        const nextOrder = pages.length ? Math.max(...pages.map((page) => page.sort_order)) + 1 : 0;
        const { error } = await supabase.from("pos_keypad_pages").insert({ layout_id: layoutId, page_name: pageName.trim() || "Ny side", sort_order: nextOrder, background_color: normalizeOptional(pageColor) });
        if (error) throw error;
      } else if (pageDialog.page) {
        const update = pageDialog.mode === "rename" ? { page_name: pageName.trim() || pageDialog.page.page_name } : { background_color: normalizeOptional(pageColor) };
        const { error } = await supabase.from("pos_keypad_pages").update(update).eq("id", pageDialog.page.id);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_pages", layoutId] });
      setPageDialog(null);
      toast.success("Side lagret");
    },
    onError: (error) => toast.error("Kunne ikke lagre side", { description: error instanceof Error ? error.message : "Ukjent feil" }),
  });

  const deletePageMutation = useMutation({
    mutationFn: async (page: KeypadPage) => {
      if (pages.length <= 1) throw new Error("Et layout må ha minst én side");
      const { error } = await supabase.from("pos_keypad_pages").delete().eq("id", page.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_pages", layoutId] });
      setDeletePage(null);
      toast.success("Side slettet");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Kunne ikke slette side"),
  });

  const reorderPageMutation = useMutation({
    mutationFn: async ({ pageId, direction }: { pageId: string; direction: -1 | 1 }) => {
      const index = pages.findIndex((page) => page.id === pageId);
      const target = pages[index + direction];
      const page = pages[index];
      if (!target || !page) return;
      const { error: firstError } = await supabase.from("pos_keypad_pages").update({ sort_order: target.sort_order }).eq("id", page.id);
      if (firstError) throw firstError;
      const { error: secondError } = await supabase.from("pos_keypad_pages").update({ sort_order: page.sort_order }).eq("id", target.id);
      if (secondError) throw secondError;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pos_keypad_pages", layoutId] }),
  });

  const moveButtonMutation = useMutation({
    mutationFn: async ({ button, x, y }: { button: KeypadButton; x: number; y: number }) => {
      if (!layout) return;
      const candidate = { grid_x: x, grid_y: y, grid_width: button.grid_width, grid_height: button.grid_height };
      if (candidate.grid_x + candidate.grid_width > layout.grid_cols || candidate.grid_y + candidate.grid_height > layout.grid_rows) throw new Error("Knappen går utenfor gridet");
      if (hasCollision(candidate, buttons, button.id)) throw new Error("Kollisjon med annen knapp");
      const { error } = await supabase.from("pos_keypad_buttons").update({ grid_x: x, grid_y: y }).eq("id", button.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_buttons", activePageId] });
      toast.success("Knapp flyttet");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Kunne ikke flytte knapp"),
  });

  const resizeButtonMutation = useMutation({
    mutationFn: async ({ button, w, h }: { button: KeypadButton; w: number; h: number }) => {
      if (!layout) return;
      const maxW = layout.grid_cols - button.grid_x;
      const maxH = layout.grid_rows - button.grid_y;
      const newW = Math.max(1, Math.min(maxW, w));
      const newH = Math.max(1, Math.min(maxH, h));
      const candidate = { grid_x: button.grid_x, grid_y: button.grid_y, grid_width: newW, grid_height: newH };
      if (hasCollision(candidate, buttons, button.id)) throw new Error("Kollisjon med annen knapp");
      const { error } = await supabase.from("pos_keypad_buttons").update({ grid_width: newW, grid_height: newH }).eq("id", button.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pos_keypad_buttons", activePageId] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Kunne ikke endre størrelse"),
  });

  const resizeGridMutation = useMutation({
    mutationFn: async ({ cols, rows }: { cols: number; rows: number }) => {
      if (!layout) return;
      const newCols = Math.max(1, Math.min(12, Math.round(cols)));
      const newRows = Math.max(1, Math.min(12, Math.round(rows)));
      if (newCols === layout.grid_cols && newRows === layout.grid_rows) return;
      // Sjekk at ingen knapp på noen side går utenfor det nye gridet.
      const { data: pageRows, error: pErr } = await supabase
        .from("pos_keypad_pages")
        .select("id")
        .eq("layout_id", layout.id);
      if (pErr) throw pErr;
      const pageIds = (pageRows ?? []).map((p) => p.id);
      if (pageIds.length > 0) {
        const { data: allButtons, error: bErr } = await supabase
          .from("pos_keypad_buttons")
          .select("grid_x, grid_y, grid_width, grid_height")
          .in("page_id", pageIds);
        if (bErr) throw bErr;
        const offending = (allButtons ?? []).find(
          (b) => b.grid_x + b.grid_width > newCols || b.grid_y + b.grid_height > newRows,
        );
        if (offending) {
          throw new Error(
            `Minst én knapp ligger utenfor ${newCols} × ${newRows}. Flytt eller skaler den ned først.`,
          );
        }
      }
      const { error } = await supabase
        .from("pos_keypad_layouts")
        .update({ grid_cols: newCols, grid_rows: newRows, updated_at: new Date().toISOString() })
        .eq("id", layout.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_layout", layoutId] });
      toast.success("Grid-størrelse oppdatert");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Kunne ikke endre grid"),
  });


  function openButtonDialog(x: number, y: number, button?: KeypadButton) {
    setSelectedCell(button ? null : { x, y });
    setEditingButton(button ?? null);
    setButtonDialogOpen(true);
  }

  function onDragStart(event: DragStartEvent) {
    const button = buttons.find((item) => item.id === event.active.id);
    setDraggingButton(button ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    const button = draggingButton;
    setDraggingButton(null);
    if (!button || !event.over?.data.current) return;
    const { x, y } = event.over.data.current as { x: number; y: number };
    moveButtonMutation.mutate({ button, x, y });
  }

  if (layoutLoading || pagesLoading) {
    return <div className="space-y-4"><Skeleton className="h-12 w-96" /><Skeleton className="h-[620px] w-full" /></div>;
  }

  if (layoutError || !layout) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Kunne ikke laste layout</AlertTitle>
        <AlertDescription>{layoutError instanceof Error ? layoutError.message : "Layout finnes ikke"}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-3">
            <Link to="/pos-styring/tastatur"><ArrowLeft className="h-4 w-4" /> Tilbake til layouts</Link>
          </Button>
          <h1 className="text-3xl font-semibold tracking-normal">{layout.display_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Grid</span>
            <div className="inline-flex items-center gap-1 rounded-md border bg-card px-1 py-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={resizeGridMutation.isPending || layout.grid_cols <= 1}
                onClick={() => resizeGridMutation.mutate({ cols: layout.grid_cols - 1, rows: layout.grid_rows })}
                aria-label="Færre kolonner"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Input
                type="number"
                min={1}
                max={12}
                value={layout.grid_cols}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 1 && v <= 12 && v !== layout.grid_cols) {
                    resizeGridMutation.mutate({ cols: v, rows: layout.grid_rows });
                  }
                }}
                className="h-6 w-12 border-0 px-1 text-center text-sm focus-visible:ring-0"
                aria-label="Kolonner"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={resizeGridMutation.isPending || layout.grid_cols >= 12}
                onClick={() => resizeGridMutation.mutate({ cols: layout.grid_cols + 1, rows: layout.grid_rows })}
                aria-label="Flere kolonner"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <span>×</span>
            <div className="inline-flex items-center gap-1 rounded-md border bg-card px-1 py-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={resizeGridMutation.isPending || layout.grid_rows <= 1}
                onClick={() => resizeGridMutation.mutate({ cols: layout.grid_cols, rows: layout.grid_rows - 1 })}
                aria-label="Færre rader"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Input
                type="number"
                min={1}
                max={12}
                value={layout.grid_rows}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 1 && v <= 12 && v !== layout.grid_rows) {
                    resizeGridMutation.mutate({ cols: layout.grid_cols, rows: v });
                  }
                }}
                className="h-6 w-12 border-0 px-1 text-center text-sm focus-visible:ring-0"
                aria-label="Rader"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={resizeGridMutation.isPending || layout.grid_rows >= 12}
                onClick={() => resizeGridMutation.mutate({ cols: layout.grid_cols, rows: layout.grid_rows + 1 })}
                aria-label="Flere rader"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <span>·</span>
            <span>{activeEntity?.short_code}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
            <Switch
              checked={layout.show_product_image}
              onCheckedChange={(checked) => toggleShowImagesMutation.mutate(checked)}
              disabled={toggleShowImagesMutation.isPending}
            />
            <span className="font-medium">Vis produktbilder på taster</span>
          </label>
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen((v) => !v)}>
            {previewOpen ? "Skjul forhåndsvisning" : "Vis forhåndsvisning"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setThemeSettingsOpen(true)}>
            <Palette className="h-4 w-4" /> Brand & layout
          </Button>
          <Button size="sm" onClick={() => setTemplatesOpen(true)}>
            <Sparkles className="h-4 w-4" /> Maler & tema
          </Button>
        </div>
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="flex min-h-0 flex-col rounded-lg border bg-card p-3 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Pages</h2>
            <Button size="sm" variant="outline" onClick={() => { setPageName("Ny side"); setPageColor(""); setPageDialog({ mode: "create" }); }}>
              <Plus className="h-4 w-4" /> Ny
            </Button>
          </div>
          <div className="space-y-2">
            {pages.map((page, index) => (
              <ContextMenu key={page.id}>
                <ContextMenuTrigger asChild>
                  <button
                    className={cn("flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors", page.id === activePageId ? "border-primary bg-primary/10 text-primary" : "bg-background hover:bg-accent")}
                    onClick={() => setActivePageId(page.id)}
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{page.page_name}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"><MoreHorizontal className="h-4 w-4" /></span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={index === 0} onClick={() => reorderPageMutation.mutate({ pageId: page.id, direction: -1 })}>Flytt opp</DropdownMenuItem>
                        <DropdownMenuItem disabled={index === pages.length - 1} onClick={() => reorderPageMutation.mutate({ pageId: page.id, direction: 1 })}>Flytt ned</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setPageName(page.page_name); setPageDialog({ mode: "rename", page }); }}>Gi nytt navn</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setPageColor(page.background_color ?? ""); setPageDialog({ mode: "color", page }); }}>Endre bakgrunn</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletePage(page)}>Slett</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => { setPageName(page.page_name); setPageDialog({ mode: "rename", page }); }}>Gi nytt navn</ContextMenuItem>
                  <ContextMenuItem onClick={() => { setPageColor(page.background_color ?? ""); setPageDialog({ mode: "color", page }); }}>Endre bakgrunn</ContextMenuItem>
                  <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletePage(page)}>Slett</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        </aside>

        <section className="min-w-0 rounded-lg border bg-card p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{activePage?.page_name ?? "Ingen side"}</h2>
            <span className="text-xs text-muted-foreground">Klikk tom celle for ny knapp · dra knapp for å flytte</span>
          </div>
          {buttonsLoading ? <Skeleton className="h-[560px] w-full" /> : activePage ? (
            <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
              <div
                className="grid h-[min(64vh,680px)] min-h-[480px] gap-2 rounded-lg border bg-muted/30 p-3"
                style={{
                  gridTemplateColumns: `repeat(${layout.grid_cols}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${layout.grid_rows}, minmax(0, 1fr))`,
                  backgroundColor: activePage.background_color ?? undefined,
                }}
              >
                {Array.from({ length: layout.grid_cols * layout.grid_rows }).map((_, index) => {
                  const x = index % layout.grid_cols;
                  const y = Math.floor(index / layout.grid_cols);
                  const anchoredButton = buttonByCell.get(`${x}-${y}`);
                  const occupied = buttons.some((button) => button.grid_x <= x && x < button.grid_x + button.grid_width && button.grid_y <= y && y < button.grid_y + button.grid_height);
                  if (anchoredButton) {
                    return (
                      <div key={`${x}-${y}`} className="min-h-0" style={{ gridColumn: `${x + 1} / span ${anchoredButton.grid_width}`, gridRow: `${y + 1} / span ${anchoredButton.grid_height}` }}>
                        <DraggableButton button={anchoredButton} layout={layout} onEdit={() => openButtonDialog(x, y, anchoredButton)} onResize={(w, h) => resizeButtonMutation.mutate({ button: anchoredButton, w, h })} />
                      </div>
                    );
                  }
                  if (occupied) return null;
                  return <DroppableCell key={`${x}-${y}`} x={x} y={y}><button className="h-full w-full rounded-md" aria-label={`Ny knapp ${x + 1}, ${y + 1}`} onClick={() => openButtonDialog(x, y)} /></DroppableCell>;
                })}
              </div>
              <DragOverlay>{draggingButton ? <div className="h-24 w-32"><KeypadButtonTile button={draggingButton} dragging /></div> : null}</DragOverlay>
            </DndContext>
          ) : (
            <div className="flex h-96 items-center justify-center text-muted-foreground">Opprett en page for å starte.</div>
          )}
        </section>
      </div>

      {activePageId && (
        <ButtonDialog open={buttonDialogOpen} onOpenChange={setButtonDialogOpen} pageId={activePageId} layout={layout} buttons={buttons} pages={pages} cell={selectedCell} button={editingButton} activeEntityId={activeEntityId!} />
      )}

      <Dialog open={!!pageDialog} onOpenChange={(open) => !open && setPageDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pageDialog?.mode === "create" ? "Ny page" : pageDialog?.mode === "rename" ? "Gi nytt navn" : "Endre bakgrunn"}</DialogTitle>
            <DialogDescription>Oppdater page-metadata for layoutet.</DialogDescription>
          </DialogHeader>
          {pageDialog?.mode !== "color" ? (
            <div className="space-y-2"><label className="text-sm font-medium" htmlFor="page-name">Navn</label><Input id="page-name" value={pageName} onChange={(event) => setPageName(event.target.value)} /></div>
          ) : (
            <div className="space-y-2"><label className="text-sm font-medium" htmlFor="page-color">Bakgrunnsfarge</label><div className="flex gap-2"><Input id="page-color" value={pageColor} onChange={(event) => setPageColor(event.target.value)} placeholder="#FEDCBA" /><Input type="color" className="h-10 w-14 p-1" value={pageColor || "#f8fafc"} onChange={(event) => setPageColor(event.target.value)} /></div></div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPageDialog(null)}>Avbryt</Button>
            <Button onClick={() => pageMutation.mutate()} disabled={pageMutation.isPending}>Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePage} onOpenChange={(open) => !open && setDeletePage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett page?</AlertDialogTitle>
            <AlertDialogDescription>{pages.length <= 1 ? "Et layout må ha minst én page." : "Dette sletter page med alle knapper."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction disabled={pages.length <= 1} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deletePage && deletePageMutation.mutate(deletePage)}>Slett</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {previewOpen && (
        <section className="rounded-lg border bg-card p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Live forhåndsvisning</h2>
              <p className="text-xs text-muted-foreground">Samme render som kasse-skjermen bruker. Drevet av layoutens tema.</p>
            </div>
          </div>
          <div className="overflow-hidden rounded-md border" style={{ aspectRatio: "16 / 9" }}>
            <KioskRender
              theme={parseTheme(layout.theme)}
              gridCols={layout.grid_cols}
              gridRows={layout.grid_rows}
              pages={pages.map((p) => ({
                id: p.id,
                page_name: p.page_name,
                sort_order: p.sort_order,
                background_color: p.background_color,
              }))}
              buttons={buttons.map((b) => ({
                id: b.id,
                page_id: b.page_id,
                button_type: b.button_type,
                display_label: b.display_label ?? (b.product?.display_name ?? null),
                image_url: b.image_url,
                background_color: b.background_color,
                text_color: b.text_color,
                grid_x: b.grid_x,
                grid_y: b.grid_y,
                grid_width: b.grid_width,
                grid_height: b.grid_height,
              }))}
              currentPageId={activePageId}
              headerLabel={layout.display_name}
            />
          </div>
        </section>
      )}

      {layoutId && (
        <TemplatesDialog
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          layoutId={layoutId}
          currentGridCols={layout.grid_cols}
          currentGridRows={layout.grid_rows}
        />
      )}

      {layoutId && (
        <ThemeSettingsDialog
          open={themeSettingsOpen}
          onOpenChange={setThemeSettingsOpen}
          layoutId={layoutId}
          legalEntityId={layout.legal_entity_id}
          initialTheme={layout.theme}
          initialCustomerScreen={layout.customer_screen}
        />
      )}
    </div>
  );
}

function DraggableButton({ button, layout, onEdit, onResize }: { button: KeypadButton; layout?: KeypadLayoutDetail; onEdit: () => void; onResize?: (w: number, h: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggableCompat(button.id);
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} className="h-full min-h-0" {...attributes} {...listeners}>
      <KeypadButtonTile button={button} layout={layout} onEdit={onEdit} dragging={isDragging} onResize={onResize} />
    </div>
  );
}

function useDraggableCompat(id: string) {
  return useDraggable({ id });
}

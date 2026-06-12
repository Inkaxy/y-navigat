import { useEffect, useMemo, useRef, useState } from "react";
import { ImageIcon, Loader2, MoreHorizontal, Search, Star, Trash2, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const BUCKET = "pos-product-images";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

interface ProductImage {
  id: string;
  product_id: string;
  storage_path: string;
  is_primary: boolean;
  signed_url?: string;
}

interface ProductCardItem {
  id: string;
  display_name: string;
  pos_display_name: string | null;
  display_number: number | null;
  image_url: string | null;
  status: string;
  mva_rate: number;
  in_pos: boolean;
  pos_print_station_id: string | null;
}

interface StationOption {
  id: string;
  display_name: string;
  is_active: boolean;
}

const NO_STATION = "__none__";

async function getSignedUrl(storagePath: string | null) {
  if (!storagePath) return undefined;
  const cached = signedUrlCache.get(storagePath);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  if (error) throw error;
  signedUrlCache.set(storagePath, { url: data.signedUrl, expiresAt: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

async function fetchProductsForPos(activeEntityId: string): Promise<ProductCardItem[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, display_name, pos_display_name, display_number, image_url, status, mva_rate, in_pos, pos_print_station_id")
    .eq("legal_entity_id", activeEntityId)
    .eq("in_pos", true)
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProductCardItem[];
}

async function fetchStations(activeEntityId: string): Promise<StationOption[]> {
  const { data, error } = await supabase
    .from("pos_print_stations")
    .select("id, display_name, is_active")
    .eq("legal_entity_id", activeEntityId)
    .order("display_name");
  if (error) throw error;
  return (data ?? []) as StationOption[];
}

async function fetchProductImages(productId: string): Promise<ProductImage[]> {
  const { data, error } = await supabase
    .from("pos_product_images")
    .select("id, product_id, storage_path, is_primary")
    .eq("product_id", productId)
    .order("is_primary", { ascending: false })
    .order("uploaded_at", { ascending: true });
  if (error) throw error;

  return Promise.all(
    ((data ?? []) as ProductImage[]).map(async (image) => ({
      ...image,
      signed_url: await getSignedUrl(image.storage_path),
    })),
  );
}

function extensionFor(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function ProductsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <Card key={index}>
          <Skeleton className="aspect-[4/3] rounded-b-none" />
          <CardHeader>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

function ProductImageDialog({ product, activeEntityId, open, onOpenChange }: { product: ProductCardItem | null; activeEntityId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageToDelete, setImageToDelete] = useState<ProductImage | null>(null);
  const [posName, setPosName] = useState<string>("");

  useEffect(() => {
    setPosName(product?.pos_display_name ?? "");
  }, [product?.id, product?.pos_display_name]);

  const { data: images = [], isLoading } = useQuery({
    queryKey: ["product_images", product?.id],
    queryFn: () => fetchProductImages(product!.id),
    enabled: open && !!product?.id,
  });

  const savePosNameMutation = useMutation({
    mutationFn: async (next: string | null) => {
      if (!product) return;
      const { error } = await supabase
        .from("products")
        .update({ pos_display_name: next })
        .eq("id", product.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("POS-visningsnavn lagret");
      await queryClient.invalidateQueries({ queryKey: ["products_for_pos", activeEntityId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Kunne ikke lagre navn"),
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["product_images", product?.id] }),
      queryClient.invalidateQueries({ queryKey: ["products_for_pos", activeEntityId] }),
    ]);
  };

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!product) return;
      if (!ALLOWED_MIME.has(file.type)) throw new Error("Kun JPEG, PNG og WebP er tillatt");
      if (file.size > MAX_FILE_SIZE) throw new Error("Bildet kan maks være 5 MB");

      let storagePath = "";
      let uploadError: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        storagePath = `${activeEntityId}/${product.id}/${crypto.randomUUID()}.${extensionFor(file)}`;
        const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, { cacheControl: "3600", upsert: false });
        if (!error) {
          uploadError = null;
          break;
        }
        uploadError = error;
        if (!error.message.includes("409") && !error.message.toLowerCase().includes("already")) break;
      }
      if (uploadError) {
        if (uploadError.message.toLowerCase().includes("quota")) throw new Error("Lagringskvote overskredet — kontakt admin");
        throw uploadError;
      }

      const { count, error: countError } = await supabase
        .from("pos_product_images")
        .select("id", { count: "exact", head: true })
        .eq("product_id", product.id);
      if (countError) throw countError;

      const { error } = await supabase.from("pos_product_images").insert({
        product_id: product.id,
        storage_path: storagePath,
        is_primary: (count ?? 0) === 0,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Bilde lastet opp");
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Kunne ikke laste opp bilde"),
  });

  const primaryMutation = useMutation({
    mutationFn: async (image: ProductImage) => {
      if (!product) return;
      const { error: unsetError } = await supabase.from("pos_product_images").update({ is_primary: false }).eq("product_id", product.id);
      if (unsetError) throw unsetError;
      const { error: setError } = await supabase.from("pos_product_images").update({ is_primary: true }).eq("id", image.id);
      if (setError) throw setError;
    },
    onSuccess: async () => {
      toast.success("Primærbilde oppdatert");
      await invalidate();
    },
    onError: (error) => toast.error("Kunne ikke sette primærbilde", { description: error instanceof Error ? error.message : "Ukjent feil" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (image: ProductImage) => {
      if (!product) return;
      const remaining = images.filter((item) => item.id !== image.id);
      const { error: dbError } = await supabase.from("pos_product_images").delete().eq("id", image.id);
      if (dbError) throw dbError;

      const { error: storageError } = await supabase.storage.from(BUCKET).remove([image.storage_path]);
      if (storageError) console.warn("Orphaned product image file", storageError);

      if (image.is_primary && remaining.length > 0) {
        const next = remaining[0];
        const { error } = await supabase.from("pos_product_images").update({ is_primary: true }).eq("id", next.id);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success("Bilde slettet");
      setImageToDelete(null);
      await invalidate();
    },
    onError: (error) => toast.error("Kunne ikke slette bilde", { description: error instanceof Error ? error.message : "Ukjent feil" }),
  });

  const handleFile = (file?: File) => {
    if (file) uploadMutation.mutate(file);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{product?.display_name ?? "Produktbilder"}</DialogTitle>
            <DialogDescription>Administrer bildene som vises i POS Kiosk og tastatur-layouts.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <label className="text-sm font-medium">POS-visningsnavn</label>
            <p className="text-xs text-muted-foreground">
              Standard er navnet fra Varer-appen ({product?.display_name ?? "—"}). Sett et eget navn her for å overstyre kun i POS/kasse — originalnavnet i Varer endres ikke.
            </p>
            <div className="flex gap-2">
              <Input
                value={posName}
                onChange={(e) => setPosName(e.target.value)}
                placeholder={product?.display_name ?? ""}
              />
              <Button
                variant="outline"
                disabled={savePosNameMutation.isPending || posName === (product?.pos_display_name ?? "")}
                onClick={() => savePosNameMutation.mutate(posName.trim() ? posName.trim() : null)}
              >
                {savePosNameMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lagre"}
              </Button>
              {product?.pos_display_name && (
                <Button
                  variant="ghost"
                  onClick={() => { setPosName(""); savePosNameMutation.mutate(null); }}
                  disabled={savePosNameMutation.isPending}
                >
                  Tilbakestill
                </Button>
              )}
            </div>
          </div>


          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
          ) : images.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">POS-spesifikke bilder overstyrer Varer-appens hovedbilde i kassen. Primærbildet vises i POS Kiosk.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {images.map((image) => (
                  <div key={image.id} className="overflow-hidden rounded-lg border bg-card">
                    <div className="relative aspect-[4/3] bg-muted">
                      {image.signed_url ? <img src={image.signed_url} alt="Produktbilde" className="h-full w-full object-cover" /> : <ImageIcon className="m-auto h-10 w-10 text-muted-foreground" />}
                      {image.is_primary && <Badge className="absolute left-2 top-2"><Star className="h-3 w-3" /> Primær</Badge>}
                    </div>
                    <div className="flex items-center justify-between p-2">
                      <span className="truncate text-xs text-muted-foreground">{image.storage_path.split("/").pop()}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={image.is_primary} onClick={() => primaryMutation.mutate(image)}>Sett som primær</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setImageToDelete(image)}><Trash2 className="h-4 w-4" /> Slett</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : product?.image_url ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Standard: arvet fra Varer-appens hovedbilde. Last opp under for å overstyre kun i POS — Varer-bildet beholdes uendret.</p>
              <div className="overflow-hidden rounded-lg border bg-card sm:w-1/3">
                <div className="relative aspect-[4/3] bg-muted">
                  <img src={product.image_url} alt="Arvet fra Varer" className="h-full w-full object-cover" />
                  <Badge variant="secondary" className="absolute left-2 top-2">Arvet fra Varer</Badge>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">Ingen bilder — last opp et POS-spesifikt bilde under.</div>
          )}

          <div
            className={cn("rounded-lg border border-dashed bg-muted/30 p-6 text-center transition-colors", uploadMutation.isPending && "opacity-70")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handleFile(event.dataTransfer.files?.[0]);
            }}
          >
            <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Dra et bilde hit, eller velg fil</p>
            <p className="mt-1 text-xs text-muted-foreground">JPEG, PNG eller WebP · maks 5 MB</p>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} />
            <Button type="button" variant="outline" className="mt-4" disabled={uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
              {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploadMutation.isPending ? "Laster opp…" : "Velg fil"}
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Lukk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!imageToDelete} onOpenChange={(open) => !open && setImageToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett bildet?</AlertDialogTitle>
            <AlertDialogDescription>Det kan ikke gjenopprettes.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => imageToDelete && deleteMutation.mutate(imageToDelete)}>Slett</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function Produkter() {
  const { activeEntityId, activeEntity } = useLegalEntity();
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductCardItem | null>(null);

  const { data: products = [], isLoading, error } = useQuery({
    queryKey: ["products_for_pos", activeEntityId],
    queryFn: () => fetchProductsForPos(activeEntityId!),
    enabled: !!activeEntityId,
  });

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (product) =>
        product.display_name.toLowerCase().includes(term) ||
        (product.pos_display_name ?? "").toLowerCase().includes(term) ||
        String(product.display_number ?? "").toLowerCase().includes(term),
    );
  }, [products, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">Produkter</h1>
          <p className="mt-1 text-sm text-muted-foreground">{activeEntity ? `${activeEntity.short_code} — ${activeEntity.legal_name}` : "Velg aktiv enhet"}</p>
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Søk navn eller varenummer" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>

      <Alert>
        <ImageIcon className="h-4 w-4" />
        <AlertTitle>Bilde-forvaltning</AlertTitle>
        <AlertDescription>Produkter opprettes i Varer-appen og må ha «Tilgjengelig i kasse» aktivert. Her forvaltes bilder som vises i POS Kiosk.</AlertDescription>
      </Alert>

      {isLoading ? <ProductsSkeleton /> : error ? (
        <Alert variant="destructive">
          <AlertTitle>Kunne ikke laste produkter</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : "Ukjent feil"}</AlertDescription>
        </Alert>
      ) : filteredProducts.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm font-medium text-foreground">Ingen produkter er overført til POS ennå</p>
          <p className="text-xs text-muted-foreground">Huk av «Tilgjengelig i kasse» på varekortet i Varer-appen for å vise produkter her.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {filteredProducts.map((product) => (
            <Card key={product.id} className="overflow-hidden transition-shadow hover:shadow-md">
              <button type="button" className="block w-full text-left" onClick={() => setSelectedProduct(product)}>
                <div className="flex aspect-[4/3] items-center justify-center bg-muted">
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.display_name} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <ImageIcon className="h-12 w-12 text-muted-foreground" />
                  )}
                </div>
                <CardHeader className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="line-clamp-2 text-base">{product.pos_display_name?.trim() || product.display_name}</CardTitle>
                      {product.pos_display_name?.trim() && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">Varer: {product.display_name}</p>
                      )}
                    </div>
                    {product.display_number && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        #{product.display_number}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={product.status === "draft" ? "secondary" : "default"}>{product.status}</Badge>
                    <Badge variant="outline">MVA {product.mva_rate}%</Badge>
                    {product.pos_display_name?.trim() && <Badge variant="secondary">POS-navn</Badge>}
                  </div>
                </CardHeader>
              </button>
            </Card>
          ))}
        </div>
      )}

      <ProductImageDialog product={selectedProduct} activeEntityId={activeEntityId ?? ""} open={!!selectedProduct} onOpenChange={(open) => !open && setSelectedProduct(null)} />
    </div>
  );
}

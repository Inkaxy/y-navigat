import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X } from "lucide-react";
import { NB_LEGAL_ENTITY_ID } from "@/varer/lib/constants";
import { logAudit } from "@/varer/lib/audit";
import { useToast } from "@/hooks/use-toast";

const BUCKET = "cake-category-images";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hvis satt → edit-mode. Ellers → create-mode. */
  category?: {
    id: string;
    name: string;
    description: string | null;
    image_url: string | null;
  } | null;
  onSaved?: (id: string) => void;
}

export function NewCategoryDialog({ open, onOpenChange, category, onSaved }: Props) {
  const isEdit = !!category;
  const qc = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      setName(category?.name ?? "");
      setDescription(category?.description ?? "");
      setImageUrl(category?.image_url ?? null);
    }
  }, [open, category]);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${NB_LEGAL_ENTITY_ID}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (e: any) {
      toast({ title: "Bilde-opplasting feilet", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Navn er påkrevd");

      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id ?? null;

      if (isEdit && category) {
        const { error } = await supabase
          .from("cake_categories")
          .update({
            name: trimmedName,
            description: description.trim() || null,
            image_url: imageUrl,
            updated_by: userId,
          })
          .eq("id", category.id);
        if (error) throw error;
        await logAudit({
          action: "cake_category_updated",
          entity_type: "cake_category",
          entity_id: category.id,
          entity_display_reference: trimmedName,
          changes: { name: trimmedName, description, image_url: imageUrl },
        });
        return category.id;
      }

      // Compute next sort_order
      const { data: maxRow } = await supabase
        .from("cake_categories")
        .select("sort_order")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextOrder = (maxRow?.sort_order ?? 0) + 1;

      const { data, error } = await supabase
        .from("cake_categories")
        .insert({
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          name: trimmedName,
          description: description.trim() || null,
          image_url: imageUrl,
          sort_order: nextOrder,
          status: "draft",
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        action: "cake_category_created",
        entity_type: "cake_category",
        entity_id: data.id,
        entity_display_reference: trimmedName,
      });
      return data.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["cake-categories"] });
      qc.invalidateQueries({ queryKey: ["cake-category", id] });
      toast({ title: isEdit ? "Kategori oppdatert" : "Kategori opprettet" });
      onOpenChange(false);
      onSaved?.(id);
    },
    onError: (e: any) => {
      toast({ title: "Kunne ikke lagre", description: e.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rediger kake-kategori" : "Ny kake-kategori"}</DialogTitle>
          <DialogDescription>
            Kake-kategorier (f.eks. «Sjokoladekake») grupperer steg som kunden går gjennom i wizarden.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cc-name">Navn *</Label>
            <Input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sjokoladekake" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-desc">Beskrivelse</Label>
            <Textarea
              id="cc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Kort intro som vises til kunden i wizarden"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Bilde</Label>
            {imageUrl ? (
              <div className="relative inline-block">
                <img src={imageUrl} alt="forhåndsvisning" className="h-32 w-32 rounded-md object-cover" />
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  className="absolute -right-2 -top-2 h-6 w-6"
                  onClick={() => setImageUrl(null)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <label className="flex h-32 w-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border text-muted-foreground hover:border-app hover:text-app">
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Upload className="h-5 w-5" />
                    <span className="text-xs">Last opp</span>
                  </>
                )}
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || uploading}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Lagre" : "Opprett"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

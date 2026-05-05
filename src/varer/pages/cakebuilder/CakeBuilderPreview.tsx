import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Cake, Eye, Loader2 } from "lucide-react";
import { NB_LEGAL_ENTITY_ID } from "@/lib/constants";
import { CakeBuilder } from "@/features/cakeBuilder/CakeBuilder";
import { toast } from "sonner";

/**
 * Forhåndsvisning av kakebyggeren — admin-overflate i Varer.
 *
 * Viser den ekte <CakeBuilder/>-komponenten (samme som POS, Ordre og
 * Kundeportal iframer via /embed/kakebygger/:categoryId), slik at det
 * brukerne ser i kundeportalen er pixel-likt det admin ser her.
 *
 * Tidligere lå det en egen preview-implementasjon her med direkte
 * Supabase-spørringer og custom rendering. Den er erstattet for å
 * sikre én kodebase for kakebygger-UI.
 */
export function CakeBuilderPreview({
  open,
  onOpenChange,
  initialCategoryId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialCategoryId?: string | null;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId ?? null);

  // Reset på open / endret initialCategoryId
  useEffect(() => {
    if (open) setCategoryId(initialCategoryId ?? null);
  }, [open, initialCategoryId]);

  // Slå opp default-prisliste for entiteten — det samme oppslaget som tidligere preview gjorde.
  const priceListQuery = useQuery({
    queryKey: ["preview-default-price-list", NB_LEGAL_ENTITY_ID],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select("id")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("is_default", true)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
  });

  // Aktive kategorier — vises som et grid hvis ingen kategori er valgt.
  const categoriesQuery = useQuery({
    queryKey: ["preview-cake-categories", NB_LEGAL_ENTITY_ID],
    enabled: open && !categoryId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cake_categories")
        .select("id, name, description, image_url, status")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("status", "active")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] h-[92vh] overflow-hidden p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 py-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-app" />
            Forhåndsvisning av kakebygger
            <Badge variant="outline" className="ml-2 text-[10px]">Identisk med kundeportalen</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {priceListQuery.isLoading ? (
            <div className="flex justify-center items-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !priceListQuery.data ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <Cake className="h-10 w-10 text-muted-foreground mb-3" />
              <h3 className="text-base font-semibold mb-1">Ingen default-prisliste</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                For å forhåndsvise kakebyggeren må entiteten ha en prisliste markert som default.
              </p>
            </div>
          ) : !categoryId ? (
            categoriesQuery.isLoading ? (
              <div className="flex justify-center items-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (categoriesQuery.data ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <Cake className="h-10 w-10 text-muted-foreground mb-3" />
                <h3 className="text-base font-semibold mb-1">Ingen aktive kategorier</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Opprett og aktiver en kategori for å forhåndsvise kakebyggeren.
                </p>
              </div>
            ) : (
              <div className="p-6 overflow-y-auto h-full">
                <h3 className="text-sm font-medium text-muted-foreground mb-4">Velg en kategori å forhåndsvise</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {(categoriesQuery.data ?? []).map((c: any) => (
                    <Card
                      key={c.id}
                      className="cursor-pointer hover:border-app transition-colors overflow-hidden"
                      onClick={() => setCategoryId(c.id)}
                    >
                      {c.image_url ? (
                        <img
                          src={c.image_url}
                          alt={c.name}
                          className="w-full h-32 object-cover bg-muted"
                        />
                      ) : (
                        <div className="w-full h-32 bg-muted flex items-center justify-center">
                          <Cake className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="p-3">
                        <div className="font-medium text-sm">{c.name}</div>
                        {c.description && (
                          <div className="text-xs text-muted-foreground line-clamp-2 mt-1">
                            {c.description}
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-col h-full">
              <div className="px-4 py-2 border-b flex items-center justify-between shrink-0 bg-muted/30">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCategoryId(null)}
                  disabled={!!initialCategoryId}
                  className="text-xs"
                >
                  ← Bytt kategori
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  Forhåndsvisning — ingen ordre opprettes
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <CakeBuilder
                  categoryId={categoryId}
                  priceListId={priceListQuery.data}
                  legalEntityId={NB_LEGAL_ENTITY_ID}
                  showVatToggle
                  onComplete={(result) => {
                    toast.success(
                      `Forhåndsvisning fullført — total ${result.total_inc_mva.toFixed(2)} kr inkl. mva`,
                    );
                    close();
                  }}
                  onCancel={close}
                />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

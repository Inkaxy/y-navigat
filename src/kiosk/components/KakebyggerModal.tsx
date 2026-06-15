import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Cake, Loader2, ChevronLeft } from "lucide-react";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";
import { listenFromParent } from "@/varer/features/cakeBuilder/protocol";
import type { CakeResult } from "@/varer/features/cakeBuilder/types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  legalEntityId: string | null;
  priceListId: string | null;
  defaultPickupLocationId?: string | null;
  onCakeComplete?: (result: CakeResult) => void;
}

type Category = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
};

export function KakebyggerModal({
  open,
  onOpenChange,
  legalEntityId,
  priceListId,
  defaultPickupLocationId,
  onCakeComplete,
}: Props) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCategoryId(null);
      return;
    }
    if (!legalEntityId) return;
    let cancel = false;
    setLoading(true);
    setError(null);
    kioskSupabase
      .from("cake_categories")
      .select("id, name, description, image_url, status")
      .eq("legal_entity_id", legalEntityId)
      .eq("status", "active")
      .order("sort_order", { ascending: true })
      .then(({ data, error }) => {
        if (cancel) return;
        if (error) setError(error.message);
        else setCategories((data ?? []) as Category[]);
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [open, legalEntityId]);

  // Listen for cake-builder/done from embed iframe
  useEffect(() => {
    if (!open) return;
    const unsub = listenFromParent(() => {
      /* parent-receiver no-op */
    });
    // We are the parent — listen via raw postMessage
    const onMsg = (event: MessageEvent) => {
      const data = event.data as
        | { source?: string; version?: number; payload?: { type?: string; result?: CakeResult } }
        | undefined;
      if (!data || data.source !== "nbos-cake-builder") return;
      const t = data.payload?.type;
      if (t === "cake-builder/done" && data.payload?.result) {
        onCakeComplete?.(data.payload.result);
        onOpenChange(false);
      } else if (t === "cake-builder/cancel") {
        onOpenChange(false);
      }
    };
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("message", onMsg);
      unsub();
    };
  }, [open, onCakeComplete, onOpenChange]);

  const embedUrl =
    categoryId && priceListId && legalEntityId
      ? `/embed/kakebygger/${categoryId}?price_list_id=${priceListId}&legal_entity_id=${legalEntityId}&theme=light&vat_toggle=true&source=kiosk${
          defaultPickupLocationId
            ? `&default_pickup_location_id=${defaultPickupLocationId}`
            : ""
        }`
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 py-3 border-b shrink-0 flex-row items-center justify-between space-y-0">
          <DialogTitle className="flex items-center gap-2">
            {categoryId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCategoryId(null)}
                className="-ml-2"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Bytt kategori
              </Button>
            )}
            <Cake className="h-4 w-4 text-app" />
            Kakebygger
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {!legalEntityId || !priceListId ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <Cake className="h-10 w-10 text-muted-foreground mb-3" />
              <h3 className="text-base font-semibold mb-1">Mangler oppsett</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Terminalen mangler {!legalEntityId ? "entitet" : "default prisliste"}.
              </p>
            </div>
          ) : embedUrl ? (
            <iframe
              src={embedUrl}
              title="Kakebygger"
              className="w-full h-full border-0"
            />
          ) : loading ? (
            <div className="flex justify-center items-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : (categories ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <Cake className="h-10 w-10 text-muted-foreground mb-3" />
              <h3 className="text-base font-semibold mb-1">Ingen aktive kake-kategorier</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Opprett og aktiver en kategori i Varer → Kakebygger.
              </p>
            </div>
          ) : (
            <div className="p-6 overflow-y-auto h-full">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Velg en kategori
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {(categories ?? []).map((c) => (
                  <Card
                    key={c.id}
                    className="cursor-pointer hover:border-app transition-colors overflow-hidden"
                    onClick={() => setCategoryId(c.id)}
                  >
                    {c.image_url ? (
                      <img
                        src={c.image_url}
                        alt={c.name}
                        className="w-full h-40 object-cover bg-muted"
                      />
                    ) : (
                      <div className="w-full h-40 bg-muted flex items-center justify-center">
                        <Cake className="h-10 w-10 text-muted-foreground" />
                      </div>
                    )}
                    <div className="p-4">
                      <div className="font-medium">{c.name}</div>
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

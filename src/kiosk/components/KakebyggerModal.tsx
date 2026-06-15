import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Cake, Loader2, ChevronLeft } from "lucide-react";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";
import { listenFromParent } from "@/varer/features/cakeBuilder/protocol";
import type { CakeResult } from "@/varer/features/cakeBuilder/types";
import {
  CustomerStartStep,
  type CustomerMeta,
} from "@/varer/features/cakeBuilder/components/CustomerStartStep";

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

type Phase = "customer" | "category" | "embed";

const EMPTY_META: CustomerMeta = {
  pickup_date: null,
  pickup_location_id: null,
  name: "",
  phone: "",
  email: "",
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
  const [phase, setPhase] = useState<Phase>("customer");
  const [customerMeta, setCustomerMeta] = useState<CustomerMeta>({
    ...EMPTY_META,
    pickup_location_id: defaultPickupLocationId ?? null,
  });

  // Reset all state when the modal closes
  useEffect(() => {
    if (!open) {
      setCategoryId(null);
      setPhase("customer");
      setCustomerMeta({
        ...EMPTY_META,
        pickup_location_id: defaultPickupLocationId ?? null,
      });
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
  }, [open, legalEntityId, defaultPickupLocationId]);

  // Listen for cake-builder/done from embed iframe
  useEffect(() => {
    if (!open) return;
    const unsub = listenFromParent(() => {
      /* parent-receiver no-op */
    });
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
        // Bring user back to category list instead of fully closing — they
        // already filled in customer info, no need to redo it.
        setCategoryId(null);
        setPhase("category");
      }
    };
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("message", onMsg);
      unsub();
    };
  }, [open, onCakeComplete, onOpenChange]);

  const customerValidation = useMemo(() => {
    if (!customerMeta.pickup_date) return "Velg hentedato.";
    if (!customerMeta.pickup_location_id) return "Velg hentested.";
    if (!customerMeta.name.trim()) return "Skriv inn navn.";
    if (!customerMeta.phone.trim()) return "Skriv inn telefonnummer.";
    if (
      customerMeta.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerMeta.email.trim())
    ) {
      return "Ugyldig e-postadresse.";
    }
    return null;
  }, [customerMeta]);

  const embedUrl = useMemo(() => {
    if (!categoryId || !priceListId || !legalEntityId) return null;
    const params = new URLSearchParams({
      price_list_id: priceListId,
      legal_entity_id: legalEntityId,
      theme: "light",
      vat_toggle: "true",
      source: "kiosk",
    });
    if (customerMeta.pickup_location_id) {
      params.set("default_pickup_location_id", customerMeta.pickup_location_id);
      params.set("pickup_location_id", customerMeta.pickup_location_id);
    }
    if (customerMeta.pickup_date) params.set("pickup_date", customerMeta.pickup_date);
    if (customerMeta.name) params.set("customer_name", customerMeta.name);
    if (customerMeta.phone) params.set("customer_phone", customerMeta.phone);
    if (customerMeta.email) params.set("customer_email", customerMeta.email);
    return `/embed/kakebygger/${categoryId}?${params.toString()}`;
  }, [categoryId, priceListId, legalEntityId, customerMeta]);

  const headerTitle =
    phase === "customer"
      ? "Kundeopplysninger"
      : phase === "category"
        ? "Velg kake-kategori"
        : "Kakebygger";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 py-3 border-b shrink-0 flex-row items-center justify-between space-y-0">
          <DialogTitle className="flex items-center gap-2">
            {phase === "category" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPhase("customer")}
                className="-ml-2"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Tilbake
              </Button>
            )}
            {phase === "embed" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCategoryId(null);
                  setPhase("category");
                }}
                className="-ml-2"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Bytt kategori
              </Button>
            )}
            <Cake className="h-4 w-4 text-app" />
            {headerTitle}
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
          ) : phase === "customer" ? (
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-y-auto p-6">
                <CustomerStartStep
                  legalEntityId={legalEntityId}
                  defaultPickupLocationId={defaultPickupLocationId}
                  value={customerMeta}
                  onChange={setCustomerMeta}
                  client={kioskSupabase}
                />
              </div>
              <div className="border-t px-6 py-3 flex items-center justify-between gap-3 shrink-0">
                <div className="text-xs text-destructive min-h-[1rem]">
                  {customerValidation ?? ""}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Avbryt
                  </Button>
                  <Button
                    disabled={Boolean(customerValidation)}
                    onClick={() => setPhase("category")}
                  >
                    Videre
                  </Button>
                </div>
              </div>
            </div>
          ) : phase === "embed" && embedUrl ? (
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
                    onClick={() => {
                      setCategoryId(c.id);
                      setPhase("embed");
                    }}
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

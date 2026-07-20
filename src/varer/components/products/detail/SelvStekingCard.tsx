import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, ChefHat, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useAppContext } from "@/varer/context/AppContext";

interface Props {
  productId: string;
  productName: string;
  canWrite: boolean;
}

type ProductLite = {
  id: string;
  display_number: number;
  code: string | null;
  display_name: string;
};

export function SelvStekingCard({ productId, productName, canWrite }: Props) {
  const qc = useQueryClient();
  const { legalEntityId } = useAppContext();
  const [search, setSearch] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const productQuery = useQuery({
    queryKey: ["product-bakeable", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, is_bakeable_raw, baked_product_id, pieces_per_tray")
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        id: string;
        is_bakeable_raw: boolean | null;
        baked_product_id: string | null;
        pieces_per_tray: number | null;
      } | null;
    },
  });

  const isEnabled = !!productQuery.data?.is_bakeable_raw;
  const bakedProductId = productQuery.data?.baked_product_id ?? null;
  const piecesPerTray = productQuery.data?.pieces_per_tray ?? null;
  const [trayDraft, setTrayDraft] = useState<string>("");

  useEffect(() => {
    setTrayDraft(piecesPerTray != null ? String(piecesPerTray) : "");
  }, [piecesPerTray]);

  const bakedProductQuery = useQuery({
    queryKey: ["product-lite", bakedProductId],
    enabled: !!bakedProductId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, display_number, code, display_name")
        .eq("id", bakedProductId!)
        .maybeSingle();
      if (error) throw error;
      return data as ProductLite | null;
    },
  });

  const searchQuery = useQuery({
    queryKey: ["product-search-bakeable", legalEntityId, search],
    enabled: popoverOpen && !!legalEntityId,
    queryFn: async () => {
      let q = supabase
        .from("products")
        .select("id, display_number, code, display_name")
        .eq("legal_entity_id", legalEntityId!)
        .eq("is_for_sale", true)
        .neq("status", "discontinued")
        .neq("id", productId)
        .order("display_number", { ascending: false })
        .limit(50);
      const s = search.trim();
      if (s) {
        q = q.or(`display_name.ilike.%${s}%,code.ilike.%${s}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ProductLite[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (patch: {
      is_bakeable_raw?: boolean;
      baked_product_id?: string | null;
    }) => {
      const { error } = await supabase
        .from("products")
        .update(patch as never)
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-bakeable", productId] });
      qc.invalidateQueries({ queryKey: ["product", productId] });
      toast.success("Lagret");
    },
    onError: (e: any) => toast.error(e?.message ?? "Kunne ikke lagre"),
  });

  useEffect(() => {
    if (!popoverOpen) setSearch("");
  }, [popoverOpen]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ChefHat className="h-4 w-4 text-app" />
          Selv-steking (kundeportal)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Marker varen som «råvare som kunden steker selv». Kunder med
          selv-steking aktivert kan registrere hvor mange enheter de har
          stekt til en gitt dato. Ferdigstekte enheter blir tilgjengelig
          for klikk-og-hent og retur (kun til registrert dato).
        </p>

        <div className="flex items-center gap-3">
          <Switch
            checked={isEnabled}
            disabled={!canWrite || updateMutation.isPending || productQuery.isLoading}
            onCheckedChange={(v) =>
              updateMutation.mutate({
                is_bakeable_raw: !!v,
                ...(v ? {} : { baked_product_id: null }),
              })
            }
          />
          <Label className="text-sm">
            {isEnabled ? "Kan stekes av kunde" : "Ikke stekbar"}
          </Label>
        </div>

        {isEnabled && (
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">
              Ferdigstekt salgsprodukt
            </Label>
            {bakedProductQuery.data ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {bakedProductQuery.data.display_name}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    #{bakedProductQuery.data.display_number}
                    {bakedProductQuery.data.code
                      ? ` · ${bakedProductQuery.data.code}`
                      : ""}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canWrite || updateMutation.isPending}
                  onClick={() =>
                    updateMutation.mutate({ baked_product_id: null })
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    disabled={!canWrite}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    Velg ferdigstekt vare…
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[420px] p-2" align="start">
                  <Input
                    autoFocus
                    placeholder="Søk på navn eller kode…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="mb-2"
                  />
                  <div className="max-h-72 overflow-auto">
                    {searchQuery.isLoading ? (
                      <div className="flex items-center justify-center py-6 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : (searchQuery.data ?? []).length === 0 ? (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        Ingen treff
                      </div>
                    ) : (
                      <ul className="divide-y divide-border">
                        {searchQuery.data!.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="w-full text-left px-2 py-2 hover:bg-muted/60 rounded-sm"
                              onClick={() => {
                                updateMutation.mutate({
                                  baked_product_id: p.id,
                                });
                                setPopoverOpen(false);
                              }}
                            >
                              <div className="text-sm font-medium">
                                {p.display_name}
                              </div>
                              <div className="text-xs text-muted-foreground font-mono">
                                #{p.display_number}
                                {p.code ? ` · ${p.code}` : ""}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <p className="text-xs text-muted-foreground">
              Når kunden registrerer at «{productName}» er stekt, blir
              tilsvarende antall av valgt ferdigvare gjort tilgjengelig for
              salg og retur.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useAppContext } from "@/varer/context/AppContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Users, Plus, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";


interface Props {
  recipeId: string;
  currentProductId?: string;
  canWrite: boolean;
}

/**
 * Liten banner over oppskrifts-redigereren som viser hvilke produkter som
 * deler denne oppskriften, og lar brukeren koble flere produkter til.
 */
export function RecipeProductLinks({ recipeId, currentProductId, canWrite }: Props) {
  const { legalEntityId } = useAppContext();
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);

  const linksQuery = useQuery({
    queryKey: ["recipe-links", recipeId],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_recipe_links")
        .select("id, product_id, extra_lines, products(id, display_name, display_number, status)")
        .eq("recipe_id", recipeId);
      return data ?? [];
    },
  });

  const productsQuery = useQuery({
    queryKey: ["all-products-for-link", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id, display_name, display_number")
        .eq("legal_entity_id", legalEntityId!)
        .neq("status", "discontinued")
        .order("display_name");
      return data ?? [];
    },
  });

  const links = linksQuery.data ?? [];
  const linkedIds = new Set(links.map((l) => l.product_id));
  const candidates = (productsQuery.data ?? []).filter((p) => !linkedIds.has(p.id));

  async function addLink(productId: string) {
    const { error } = await supabase
      .from("product_recipe_links")
      .insert({ product_id: productId, recipe_id: recipeId, is_primary: false } as never);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Produkt koblet til oppskrift");
    setPickerOpen(false);
    linksQuery.refetch();
  }

  async function removeLink(linkId: string, isCurrent: boolean) {
    if (isCurrent) {
      toast.error("Du kan ikke koble fra produktet du er på nå.");
      return;
    }
    if (!confirm("Koble fra dette produktet?")) return;
    const { error } = await supabase.from("product_recipe_links").delete().eq("id", linkId);
    if (error) {
      toast.error(error.message);
      return;
    }
    linksQuery.refetch();
  }

  if (linksQuery.isLoading) return null;

  return (
    <Card className="border-app/30 bg-app/[0.03]">
      <CardContent className="py-3 flex items-center gap-3 flex-wrap">
        <Users className="h-4 w-4 text-app shrink-0" />
        <div className="text-sm">
          <span className="font-medium">Brukes av {links.length} produkt{links.length === 1 ? "" : "er"}</span>
          <span className="text-muted-foreground"> · samme oppskrift, ulike priser/tillegg</span>
        </div>
        <div className="flex flex-wrap gap-1.5 flex-1">
          {links.map((l: any) => {
            const isCurrent = l.product_id === currentProductId;
            const extraCount = Array.isArray(l.extra_lines) ? l.extra_lines.length : 0;
            return (
              <Badge
                key={l.id}
                variant={isCurrent ? "default" : "outline"}
                className="gap-1.5 pr-1 cursor-pointer hover:bg-accent"
              >
                <button
                  className="flex items-center gap-1"
                  onClick={() => !isCurrent && navigate(`/varer/vareliste/${l.product_id}?tab=deklarasjon`)}
                  title="Åpne deklarasjon for dette produktet"
                >
                  {l.products?.display_name}
                  {extraCount > 0 && <span className="text-[10px] opacity-70">+{extraCount}</span>}
                  {!isCurrent && <ExternalLink className="h-2.5 w-2.5 opacity-60" />}
                </button>
                {canWrite && !isCurrent && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeLink(l.id, isCurrent); }}
                    className="hover:text-destructive"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                )}
              </Badge>
            );
          })}
        </div>
        {canWrite && (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs">
                <Plus className="mr-1 h-3 w-3" /> Koble til produkt
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <Command>
                <CommandInput placeholder="Søk produkt…" />
                <CommandList>
                  {productsQuery.isLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <>
                      <CommandEmpty>Ingen treff</CommandEmpty>
                      <CommandGroup>
                        {candidates.slice(0, 50).map((p) => (
                          <CommandItem key={p.id} value={`${p.display_name} ${p.display_number}`} onSelect={() => addLink(p.id)}>
                            <span className="font-mono text-xs text-muted-foreground mr-2">#{p.display_number}</span>
                            {p.display_name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </CardContent>
    </Card>
  );
}

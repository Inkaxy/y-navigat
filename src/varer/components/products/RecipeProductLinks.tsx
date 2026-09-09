import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const [search, setSearch] = useState("");
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null);
  const qc = useQueryClient();

  const linksQuery = useQuery({
    queryKey: ["recipe-links", recipeId],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_recipe_links")
        .select("id, product_id, is_primary, declaration_mode, extra_lines, products(id, display_name, display_number, status)")
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
  const allCandidates = (productsQuery.data ?? []).filter((p) => !linkedIds.has(p.id));
  const term = search.trim().toLocaleLowerCase("nb-NO");
  const candidates = (
    term
      ? allCandidates.filter((p) =>
          `${p.display_name ?? ""} ${p.display_number ?? ""}`
            .toLocaleLowerCase("nb-NO")
            .includes(term),
        )
      : allCandidates
  ).slice(0, term ? 100 : 50);

  async function afterLinkChange() {
    try {
      const { error } = await supabase.functions.invoke("compute-recipe-label", { body: { recipe_id: recipeId } });
      if (error) throw error;
    } catch (e) {
      console.error("compute-recipe-label", e);
      toast.warning("Koblingen er lagret, men merkedata ble ikke beregnet på nytt. Bruk «Beregn på nytt».");
    }
    await linksQuery.refetch();
    qc.invalidateQueries({ queryKey: ["recipe-label-calculated", recipeId] });
    qc.invalidateQueries({ queryKey: ["recipe-linked-products", recipeId] });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  async function addLink(productId: string) {
    // DB-en avgjør selv om koblingen blir primær (første kobling for produktet).
    const { error } = await supabase
      .from("product_recipe_links")
      .insert({ product_id: productId, recipe_id: recipeId } as never);
    if (error) {
      if (error.code === "42501") toast.error("Mangler skrivetilgang til oppskriften");
      else if (error.code === "23514") toast.error("Sirkulær referanse — oppskriften kan ikke kobles til seg selv (via halvfabrikat)");
      else toast.error(error.message);
      return;
    }
    toast.success("Produkt koblet til oppskrift");
    setPickerOpen(false);
    await afterLinkChange();
  }

  async function removeLink(linkId: string, isCurrent: boolean) {
    if (isCurrent) {
      toast.error("Du kan ikke koble fra produktet du er på nå.");
      return;
    }
    const { error } = await supabase.from("product_recipe_links").delete().eq("id", linkId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await afterLinkChange();
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
                  {l.is_primary ? <span className="text-[10px] opacity-70">★ primær</span> : null}
                  <span className="text-[10px] opacity-70">
                    {l.declaration_mode === "manual" ? "overstyrt" : "arvet"}
                  </span>
                  {extraCount > 0 && <span className="text-[10px] opacity-70">+{extraCount}</span>}
                  {!isCurrent && <ExternalLink className="h-2.5 w-2.5 opacity-60" />}
                </button>
                {canWrite && !isCurrent && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingRemove({ id: l.id, name: l.products?.display_name ?? "produktet" });
                    }}
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
              <Command shouldFilter={false}>
                <CommandInput placeholder="Søk produkt…" value={search} onValueChange={setSearch} />
                <CommandList>
                  {productsQuery.isLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <>
                      <CommandEmpty>Ingen treff</CommandEmpty>
                      <CommandGroup>
                        {candidates.map((p) => (
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

      <AlertDialog open={!!pendingRemove} onOpenChange={(v) => !v && setPendingRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Koble fra {pendingRemove?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Produktet mister deklarasjonen som arves fra denne oppskriften. Snapshotet synkes på nytt etterpå.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = pendingRemove?.id;
                setPendingRemove(null);
                if (id) void removeLink(id, false);
              }}
            >
              Koble fra
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

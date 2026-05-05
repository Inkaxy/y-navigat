import { useEffect, useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Cake, Plus, Trash2 } from "lucide-react";
import { CAKE_ROLE_OPTIONS, NB_LEGAL_ENTITY_ID } from "@/lib/constants";
import type { ProductFormValues } from "@/lib/productSchema";

/** Lokal modell for valgte kategori/steg-koblinger.
 *  Persisteres ved Lagre-trykk fra ProductDetail. */
export interface CakeStepLink {
  cake_step_id: string;
  cake_category_id: string;
}

interface Props {
  productId: string;
  canWrite: boolean;
  links: CakeStepLink[];
  originalLinks: CakeStepLink[];
  onLinksChange: (next: CakeStepLink[]) => void;
}

export function CakeBuilderSection({
  productId,
  canWrite,
  links,
  originalLinks,
  onLinksChange,
}: Props) {
  const { watch, setValue } = useFormContext<ProductFormValues>();
  const isComponent = watch("is_cake_component");
  const role = watch("cake_role");
  const [confirmTurnOff, setConfirmTurnOff] = useState(false);

  // Last alle aktive kake-kategorier + steg for samme legal_entity
  const catsQuery = useQuery({
    queryKey: ["cake-categories-with-steps", NB_LEGAL_ENTITY_ID],
    queryFn: async () => {
      const [catsRes, stepsRes] = await Promise.all([
        supabase
          .from("cake_categories")
          .select("id, name, status")
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .neq("status", "discontinued")
          .order("sort_order", { ascending: true }),
        supabase
          .from("cake_steps")
          .select("id, name, step_order, cake_category_id")
          .order("step_order", { ascending: true }),
      ]);
      if (catsRes.error) throw catsRes.error;
      if (stepsRes.error) throw stepsRes.error;
      return {
        categories: catsRes.data ?? [],
        steps: stepsRes.data ?? [],
      };
    },
  });

  const categories = catsQuery.data?.categories ?? [];
  const steps = catsQuery.data?.steps ?? [];
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  function toggleComponent(next: boolean) {
    if (!next && (links.length > 0 || originalLinks.length > 0)) {
      setConfirmTurnOff(true);
      return;
    }
    setValue("is_cake_component", next, { shouldDirty: true });
    if (!next) {
      setValue("cake_role", null, { shouldDirty: true });
      onLinksChange([]);
    } else {
      // Fornuftig default
      if (!role) setValue("cake_role", "topping", { shouldDirty: true });
    }
  }

  function confirmTurnOffNow() {
    setValue("is_cake_component", false, { shouldDirty: true });
    setValue("cake_role", null, { shouldDirty: true });
    onLinksChange([]);
    setConfirmTurnOff(false);
  }

  function addLink() {
    if (categories.length === 0) return;
    // Velg første ledige kategori
    const usedCats = new Set(links.map((l) => l.cake_category_id));
    const firstFree = categories.find((c) => !usedCats.has(c.id)) ?? categories[0];
    const firstStep = steps.find((s) => s.cake_category_id === firstFree.id);
    if (!firstStep) return;
    onLinksChange([
      ...links,
      { cake_category_id: firstFree.id, cake_step_id: firstStep.id },
    ]);
  }

  function updateLink(index: number, patch: Partial<CakeStepLink>) {
    onLinksChange(
      links.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }

  function removeLink(index: number) {
    onLinksChange(links.filter((_, i) => i !== index));
  }

  return (
    <div className="md:col-span-2 border-t border-border pt-6 mt-2">
      <div className="flex items-center gap-2 mb-1">
        <Cake className="h-4 w-4 text-app" />
        <h3 className="text-sm font-semibold">Kakebygger</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Marker varen som byggekloss i kakebygger-wizarden, og koble til steg per kake-kategori.
      </p>

      <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 px-4 py-3 mb-4">
        <div className="space-y-1">
          <Label className="text-sm font-medium">Bruk i kakebygger</Label>
          <p className="text-xs text-muted-foreground">
            Når aktivert kan kunder velge varen som del av kake-konfigurasjonen.
          </p>
        </div>
        <Switch
          checked={!!isComponent}
          onCheckedChange={toggleComponent}
          disabled={!canWrite}
        />
      </div>

      {isComponent && (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <Label>Rolle i kakebygger</Label>
            <Controller
              name="cake_role"
              render={({ field }) => (
                <Select
                  value={field.value ?? ""}
                  onValueChange={(v) => field.onChange(v as never)}
                  disabled={!canWrite}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Velg rolle…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CAKE_ROLE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Brukes til å sortere varen øverst i matchende steg.
            </p>
          </div>

          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <Label>Tilgjengelig i kake-kategorier</Label>
              {canWrite && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLink}
                  disabled={categories.length === 0}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Legg til
                </Button>
              )}
            </div>

            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-4 text-center">
                Ingen kake-kategorier opprettet ennå. Opprett først i{" "}
                <a href="/kakebygger" className="text-app underline">
                  Kakebygger
                </a>
                .
              </p>
            ) : links.length === 0 ? (
              <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-4 text-center">
                Ingen koblinger. Klikk «Legg til» for å gjøre varen tilgjengelig i et steg.
              </p>
            ) : (
              <div className="space-y-2">
                {links.map((link, idx) => {
                  const stepsForCat = steps.filter(
                    (s) => s.cake_category_id === link.cake_category_id,
                  );
                  return (
                    <div
                      key={idx}
                      className="grid gap-2 rounded-md border border-border bg-background p-2 sm:grid-cols-[1fr_1fr_auto]"
                    >
                      <Select
                        value={link.cake_category_id}
                        onValueChange={(catId) => {
                          const firstStep = steps.find(
                            (s) => s.cake_category_id === catId,
                          );
                          updateLink(idx, {
                            cake_category_id: catId,
                            cake_step_id: firstStep?.id ?? link.cake_step_id,
                          });
                        }}
                        disabled={!canWrite}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Kategori…" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                              {c.status === "draft" && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 text-[10px]"
                                >
                                  Utkast
                                </Badge>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={link.cake_step_id}
                        onValueChange={(stepId) =>
                          updateLink(idx, { cake_step_id: stepId })
                        }
                        disabled={!canWrite || stepsForCat.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Steg…" />
                        </SelectTrigger>
                        <SelectContent>
                          {stepsForCat.length === 0 ? (
                            <SelectItem value="__none" disabled>
                              Ingen steg i kategorien
                            </SelectItem>
                          ) : (
                            stepsForCat.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.step_order}. {s.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>

                      {canWrite && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLink(idx)}
                          title="Fjern kobling"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={confirmTurnOff} onOpenChange={setConfirmTurnOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fjerne fra kakebygger?</AlertDialogTitle>
            <AlertDialogDescription>
              Du fjerner varen fra {Math.max(links.length, originalLinks.length)} kake-koblinger.
              Endringen lagres når du trykker «Lagre».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={confirmTurnOffNow}>
              Fjern fra kakebygger
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

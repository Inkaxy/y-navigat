import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Boxes, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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
import { cn } from "@/lib/utils";
import { showError } from "@/lib/userError";
import {
  useProductStock,
  useRemoveStockLink,
  useSaveOwnStockItem,
  useSaveStockLink,
  useStockItemBalances,
} from "@/varer/hooks/useProductStock";

type Mode = "none" | "is_item" | "consumes";

const nf = new Intl.NumberFormat("nb-NO");

interface Props {
  productId: string;
  productName: string;
  canWrite: boolean;
  legalEntityId: string | undefined;
  productionDepartments: { id: string; display_name: string }[];
}

export function StockTab({ productId, productName, canWrite, legalEntityId, productionDepartments }: Props) {
  const stockQuery = useProductStock(productId);
  const itemsQuery = useStockItemBalances(legalEntityId);
  const removeLink = useRemoveStockLink(productId);
  const saveOwn = useSaveOwnStockItem(productId, legalEntityId);
  const saveLink = useSaveStockLink(productId);

  const state = stockQuery.data;
  const initialMode: Mode = !state
    ? "none"
    : state.ownStockItemId
      ? "is_item"
      : state.link
        ? "consumes"
        : "none";

  const [mode, setMode] = useState<Mode>("none");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  // Skjema for «er lagervare»
  const [name, setName] = useState("");
  const [deptId, setDeptId] = useState<string>("");
  const [piecesPerTray, setPiecesPerTray] = useState("");
  const [minLevel, setMinLevel] = useState("");
  const [shelfLife, setShelfLife] = useState("");
  const [batchTracking, setBatchTracking] = useState(true);
  const [ownUnits, setOwnUnits] = useState("1");

  // Skjema for «tapper lagervare»
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [targetItemId, setTargetItemId] = useState("");
  const [targetUnits, setTargetUnits] = useState("1");

  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!state) return;
    if (seededFor.current === productId) return;
    seededFor.current = productId;
    setMode(initialMode);
    const item = state.stockItem;
    setName(item && state.ownStockItemId ? item.name : `${productName}-emne`);
    setDeptId(item?.department_id ?? "");
    setPiecesPerTray(item?.pieces_per_tray != null ? String(item.pieces_per_tray) : "");
    setMinLevel(item?.min_level != null ? String(item.min_level) : "");
    setShelfLife(item?.shelf_life_days != null ? String(item.shelf_life_days) : "");
    setBatchTracking(item ? item.batch_tracking : true);
    setOwnUnits(String(state.link?.units_per_sold_unit ?? 1));
    if (!state.ownStockItemId && state.link) {
      setTargetItemId(state.link.stock_item_id);
      setTargetUnits(String(state.link.units_per_sold_unit));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, state?.link?.id, state?.ownStockItemId, state?.stockItem?.id]);

  useEffect(() => {
    if (errorText) {
      toast.error(errorText);
      setErrorText(null);
    }
  }, [errorText]);

  useEffect(() => {
    if (successText) {
      toast.success(successText);
      setSuccessText(null);
    }
  }, [successText]);

  const items = itemsQuery.data ?? [];
  const selectableItems = useMemo(
    () => items.filter((i) => i.id !== state?.ownStockItemId),
    [items, state?.ownStockItemId],
  );
  const selectedItem = items.find((i) => i.id === targetItemId) ?? null;

  const num = (v: string): number | null => {
    const t = v.trim().replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const busy = removeLink.isPending || saveOwn.isPending || saveLink.isPending;

  const handleRemove = async () => {
    try {
      await removeLink.mutateAsync();
      setSuccessText("Varen holdes ikke lenger på lager");
    } catch (e) {
      showError("StockTab.removeLink", e, "Kunne ikke fjerne koblingen. Prøv igjen.");
    } finally {
      setConfirmRemove(false);
    }
  };

  const handleSaveOwn = async () => {
    if (!name.trim()) {
      setErrorText("Lagervaren må ha et navn");
      return;
    }
    const units = num(ownUnits);
    if (!units || units <= 0) {
      setErrorText("Enheter per solgt enhet må være større enn 0");
      return;
    }
    const tray = num(piecesPerTray);
    const min = num(minLevel);
    const shelf = num(shelfLife);
    if (tray != null && tray < 0) {
      setErrorText("Emner per plate kan ikke være negativt");
      return;
    }
    if (min != null && min < 0) {
      setErrorText("Min-nivå kan ikke være negativt");
      return;
    }
    if (shelf != null && shelf < 0) {
      setErrorText("Holdbarhet kan ikke være negativ");
      return;
    }
    try {
      await saveOwn.mutateAsync({
        name,
        department_id: deptId || null,
        pieces_per_tray: tray,
        min_level: min,
        shelf_life_days: shelf,
        batch_tracking: batchTracking,
        units_per_sold_unit: units,
        stockItemId: state?.ownStockItemId ?? null,
      });
      setSuccessText("Lagervare lagret");
    } catch (e) {
      showError("StockTab.saveOwn", e, "Kunne ikke lagre lagervaren. Prøv igjen.");
    }
  };

  const handleSaveLink = async () => {
    if (!targetItemId) {
      setErrorText("Velg hvilken lagervare varen tapper");
      return;
    }
    const units = num(targetUnits);
    if (!units || units <= 0) {
      setErrorText("Enheter per solgt enhet må være større enn 0");
      return;
    }
    try {
      await saveLink.mutateAsync({ stock_item_id: targetItemId, units_per_sold_unit: units });
      setSuccessText("Kobling lagret");
    } catch (e) {
      showError("StockTab.saveLink", e, "Kunne ikke lagre koblingen. Prøv igjen.");
    }
  };

  if (stockQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const current = state?.stockItem ?? null;

  return (
    <div className="space-y-4">
      {current && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <Boxes className="h-4 w-4" />
                {state?.ownStockItemId ? "Er lagervaren" : "Tapper"} {current.name}
                {state?.link && ` · ${nf.format(state.link.units_per_sold_unit)} per solgt enhet`}
              </div>
              <div className="text-sm text-muted-foreground">
                Beholdning nå: <span className="font-semibold tabular-nums">{nf.format(current.on_hand)}</span>{" "}
                {current.base_unit}
                {current.department_name ? ` · ${current.department_name}` : ""}
              </div>
              {state && state.family.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  {state.family
                    .map(
                      (f) =>
                        `${f.display_number ?? ""} ${f.display_name} ×${nf.format(f.units_per_sold_unit)}`.trim(),
                    )
                    .join(" · ")}
                </div>
              )}
            </div>
            <Button asChild variant="outline">
              <Link to="/produksjon/lager">Gå til lagersiden</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lagerhold</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ModeCard
            active={mode === "none"}
            title="Holdes ikke på lager"
            description="Varen produseres og pakkes uten beholdning."
            onClick={() => setMode("none")}
          />
          <ModeCard
            active={mode === "is_item"}
            title="Denne varen ER en lagervare"
            description="Produksjonen melder inn plater av denne varen."
            onClick={() => setMode("is_item")}
          />
          <ModeCard
            active={mode === "consumes"}
            title="Denne varen TAPPER en lagervare"
            description="Salg av varen trekker fra en annen lagervare."
            onClick={() => setMode("consumes")}
          />
        </CardContent>
      </Card>

      {mode === "none" && state?.link && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <p className="text-sm text-muted-foreground">
              Fjerner koblingen mellom varen og lagervaren. Selve lagervaren og historikken beholdes.
            </p>
            <Button variant="destructive" disabled={!canWrite || busy} onClick={() => setConfirmRemove(true)}>
              {removeLink.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Fjern kobling
            </Button>
          </CardContent>
        </Card>
      )}

      {mode === "none" && !state?.link && state?.ownStockItemId && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Denne varen definerer selve lagervaren «{current?.name}». Beholdning og historikk styres fra{" "}
            <Link to="/produksjon/lager" className="underline">
              lagersiden i produksjon
            </Link>
            .
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fjerne koblingen?</AlertDialogTitle>
            <AlertDialogDescription>
              Salg av «{productName}» vil ikke lenger trekke fra lagervaren. Lagervaren og historikken beholdes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove}>Fjern kobling</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {mode === "is_item" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Egenskaper for lagervaren</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="stock-name">Navn</Label>
                <Input id="stock-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
              </div>
              <div className="space-y-1.5">
                <Label>Avdeling</Label>
                <Select value={deptId} onValueChange={setDeptId} disabled={!canWrite}>
                  <SelectTrigger>
                    <SelectValue placeholder="Velg avdeling" />
                  </SelectTrigger>
                  <SelectContent>
                    {productionDepartments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stock-tray">Emner per plate</Label>
                <Input
                  id="stock-tray"
                  inputMode="decimal"
                  value={piecesPerTray}
                  onChange={(e) => setPiecesPerTray(e.target.value)}
                  placeholder="F.eks. 12"
                  disabled={!canWrite}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stock-min">Min-nivå</Label>
                <Input
                  id="stock-min"
                  inputMode="decimal"
                  value={minLevel}
                  onChange={(e) => setMinLevel(e.target.value)}
                  disabled={!canWrite}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stock-shelf">Holdbarhet (dager)</Label>
                <Input
                  id="stock-shelf"
                  inputMode="numeric"
                  value={shelfLife}
                  onChange={(e) => setShelfLife(e.target.value)}
                  disabled={!canWrite}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stock-own-units">Enheter per solgt enhet</Label>
                <Input
                  id="stock-own-units"
                  inputMode="decimal"
                  value={ownUnits}
                  onChange={(e) => setOwnUnits(e.target.value)}
                  disabled={!canWrite}
                />
                <p className="text-xs text-muted-foreground">
                  Hvor mange emner ett salg av denne varen trekker. F.eks. 4 for «deig á 4».
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <div className="font-medium">Batchsporing</div>
                <p className="text-sm text-muted-foreground">Hver innmelding får batchnummer og utløpsdato.</p>
              </div>
              <Switch checked={batchTracking} onCheckedChange={setBatchTracking} disabled={!canWrite} />
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveOwn} disabled={!canWrite || busy}>
                {saveOwn.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Lagre lagervare
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === "consumes" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hvilken lagervare tappes?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Lagervare</Label>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between font-normal"
                      disabled={!canWrite}
                    >
                      {selectedItem ? selectedItem.name : "Søk etter lagervare …"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Søk …" />
                      <CommandList>
                        <CommandEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">
                          Ingen lagervarer funnet. Lagervarer opprettes ved å velge «Denne varen ER en lagervare» på
                          hovedvarens varekort.{" "}
                          <Link to="/varer/varer" className="underline">
                            Gå til varelisten
                          </Link>
                          .
                        </CommandEmpty>
                        <CommandGroup>
                          {selectableItems.map((i) => (
                            <CommandItem
                              key={i.id}
                              value={`${i.name} ${i.department_name ?? ""}`}
                              onSelect={() => {
                                setTargetItemId(i.id);
                                setPickerOpen(false);
                              }}
                            >
                              <Check
                                className={cn("mr-2 h-4 w-4", targetItemId === i.id ? "opacity-100" : "opacity-0")}
                              />
                              <span className="flex-1">{i.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {i.department_name ?? "—"}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stock-units">Enheter per solgt enhet</Label>
                <Input
                  id="stock-units"
                  inputMode="decimal"
                  value={targetUnits}
                  onChange={(e) => setTargetUnits(e.target.value)}
                  disabled={!canWrite}
                />
              </div>
            </div>

            {selectedItem && (
              <Badge variant="secondary">
                Beholdning nå: {nf.format(selectedItem.on_hand)} {selectedItem.base_unit}
              </Badge>
            )}

            <div className="flex justify-end">
              <Button onClick={handleSaveLink} disabled={!canWrite || busy}>
                {saveLink.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Lagre kobling
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ModeCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors",
        active ? "border-app bg-app/5" : "border-border hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          active ? "border-app" : "border-muted-foreground",
        )}
      >
        {active && <span className="h-2 w-2 rounded-full bg-app" />}
      </span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

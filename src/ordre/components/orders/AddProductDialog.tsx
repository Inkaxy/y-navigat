import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useAddableProducts, type AddableProduct } from "@/hooks/useMatrix";
import { formatNOK } from "@/lib/format";

export function AddProductDialog({
  open,
  onOpenChange,
  customerId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string | null;
  onPick: (product: AddableProduct) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: products, isLoading } = useAddableProducts(customerId, open);

  const filtered = (products ?? []).filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.display_name.toLowerCase().includes(q) ||
      String(p.display_number).includes(q)
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Legg til produkt i matrisen</DialogTitle>
          <DialogDescription>
            Velg et produkt for å legge det til som ny rad. Mengder lagres først når du trykker «Lagre».
          </DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="border-t border-border">
          <CommandInput placeholder="Søk varenr eller navn …" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-[360px]">
            {isLoading ? (
              <div className="grid place-items-center py-8 text-muted-foreground">
                <Loader2 className="animate-spin" />
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {(products ?? []).length === 0
                    ? "Alle aktive produkter er allerede i matrisen."
                    : "Ingen treff."}
                </CommandEmpty>
                <CommandGroup>
                  {filtered.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      onSelect={() => {
                        onPick(p);
                        onOpenChange(false);
                        setSearch("");
                      }}
                      className="flex items-center gap-3"
                    >
                      <Plus className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground tabular-nums">{p.display_number}</span>
                      <span className="flex-1 truncate">{p.display_name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {p.unit_price == null ? "—" : formatNOK(p.unit_price)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

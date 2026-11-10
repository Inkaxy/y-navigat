import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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

interface Candidate {
  id: string;
  display_name: string | null;
  display_number: number | null;
}

/** «Koble til produkt» — samme søk og utvalg som før (50 uten søk, 100 med). */
export function LinkProductPicker({
  products,
  isLoading,
  isError,
  linkedIds,
  busy,
  onPick,
}: {
  products: Candidate[];
  isLoading: boolean;
  isError: boolean;
  linkedIds: Set<string>;
  busy: boolean;
  /** Returnerer sann når koblingen ble lagret. */
  onPick: (productId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const all = products.filter((p) => !linkedIds.has(p.id));
  const term = search.trim().toLocaleLowerCase("nb-NO");
  const candidates = (
    term
      ? all.filter((p) => `${p.display_name ?? ""} ${p.display_number ?? ""}`.toLocaleLowerCase("nb-NO").includes(term))
      : all
  ).slice(0, term ? 100 : 50);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="min-h-[44px]" disabled={busy}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
          Koble til produkt
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Søk produkt…" value={search} onValueChange={setSearch} />
          <CommandList>
            {isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Henter produkter" />
              </div>
            ) : isError ? (
              <p className="px-3 py-4 text-caption text-destructive" role="alert">Kunne ikke hente produktene. Lukk og prøv igjen.</p>
            ) : (
              <>
                <CommandEmpty>Ingen treff</CommandEmpty>
                <CommandGroup>
                  {candidates.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.display_name} ${p.display_number}`}
                      onSelect={() => {
                        void onPick(p.id).then((ok) => {
                          if (ok) setOpen(false);
                        });
                      }}
                    >
                      <span className="mr-2 font-mono text-xs text-muted-foreground">#{p.display_number}</span>
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
  );
}

/** Bekreftelsen før «Koble fra» — samme tekst som før. */
export function UnlinkConfirmDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { id: string; name: string } | null;
  onCancel: () => void;
  onConfirm: (linkId: string) => void;
}) {
  return (
    <AlertDialog open={!!pending} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Koble fra {pending?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Produktet mister deklarasjonen som arves fra denne oppskriften. Snapshotet synkes på nytt etterpå.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Avbryt</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const id = pending?.id;
              onCancel();
              if (id) onConfirm(id);
            }}
          >
            Koble fra
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

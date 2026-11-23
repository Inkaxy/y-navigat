import { useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCostPostOptions } from "@/ravarer/hooks/useCostPosts";

export type PickedPost = { id: string | null; name: string };

/**
 * Velg en kostnadspost (eller skriv navnet på en ny). `onPick` gjør selve lagringen; feil vises i velgeren og
 * velgeren holdes åpen. Synkron lås mot dobbelttrykk.
 */
export function CostPostPicker({ onPick, disabled, label = "Kostnadspost …", suggestedName = "", className }: {
  onPick: (p: PickedPost) => Promise<void>; disabled?: boolean; label?: string; suggestedName?: string; className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const options = useCostPostOptions(open);

  const pick = async (p: PickedPost) => {
    if (lock.current || !p.name.trim()) return;
    lock.current = true; setBusy(true); setError(null);
    try { await onPick(p); setOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Kunne ikke lagre."); }
    finally { lock.current = false; setBusy(false); }
  };
  const typed = name.trim().toLocaleLowerCase("nb-NO");
  const same = options.data?.find((o) => o.name.toLocaleLowerCase("nb-NO") === typed) ?? null;

  return (
    <Popover open={open} onOpenChange={(o) => { if (!busy) { setOpen(o); setError(null); if (o) setName(suggestedName); } }}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={className ?? "min-h-[44px]"} disabled={disabled}>{label}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-semibold">Legg i kostnadspost</p>
          <p className="text-caption text-ink-secondary">Linjen telles i posten på alle fakturaer fra leverandøren, også nye. Den blir ikke en vare.</p>
        </div>
        {options.isLoading && <p className="text-caption text-ink-secondary">Henter postene …</p>}
        {options.isError && <p role="alert" className="text-caption text-destructive">Kunne ikke hente postene. Du kan fortsatt skrive navnet på posten.</p>}
        {options.data && options.data.length > 0 && (
          <ul aria-label="Kostnadsposter" className="flex flex-wrap gap-2">
            {options.data.map((o) => (
              <li key={o.id}>
                <Button type="button" variant="secondary" className="min-h-[44px]" disabled={busy} onClick={() => void pick({ id: o.id, name: o.name })}>{o.name}</Button>
              </li>
            ))}
          </ul>
        )}
        <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); void pick(same ? { id: same.id, name: same.name } : { id: null, name }); }}>
          <label htmlFor={`${id}-n`} className="text-caption font-semibold">{options.data?.length ? "Eller ny post" : "Navn på posten"}</label>
          <div className="flex gap-2">
            <Input id={`${id}-n`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="F.eks. Frakt" className="h-11" disabled={busy} />
            <Button type="submit" className="min-h-[44px]" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Legg i
            </Button>
          </div>
        </form>
        {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

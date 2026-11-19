import { useId, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NEW_ITEM_TYPES, NEW_ITEM_TYPE_LABEL, searchCandidates, type Candidate, type NewItemType, type RowMode } from "@/ravarer/lib/fraFaktura/newItems";

const TYPE_LABEL: Record<string, string> = { ravare: "Råvare", videresalg: "Handelsvare", emballasje: "Emballasje" };
const kr = (v: number | null, unit: string | null) => (v == null ? null : `${v.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr/${unit ?? "enhet"}`);

/** Todelt velger: «Koble til en vare jeg har» (søk, forslag øverst) eller «Opprett som ny» (navn + type). */
export function RowTarget({ mode, onMode, pick, onPick, suggestions, suggestionLabel, candidates, name, onName, type, onType, disabled }: {
  mode: RowMode; onMode: (m: RowMode) => void;
  pick: Candidate | null; onPick: (c: Candidate | null) => void;
  suggestions: readonly Candidate[]; suggestionLabel: string; candidates: readonly Candidate[];
  name: string; onName: (v: string) => void; type: NewItemType; onType: (t: NewItemType) => void; disabled: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const hits = q.trim() ? searchCandidates(q, candidates) : [];
  const list = q.trim() ? hits : [...suggestions, ...(pick && !suggestions.some((s) => s.id === pick.id) ? [pick] : [])];
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Hva skal linjen bli?" className="inline-flex overflow-hidden rounded-lg border border-line-subtle">
        {(["koble", "opprett"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={disabled} onClick={() => onMode(m)}
            className={cn("min-h-[44px] px-3 text-sm font-semibold transition-colors", mode === m ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted")}>
            {m === "koble" ? "Koble til en vare jeg har" : "Opprett som ny"}
          </button>
        ))}
      </div>
      {mode === "koble" ? (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-q`} className="sr-only">Søk i råvarer, handelsvarer og emballasje</label>
          <Input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk i råvarer og handelsvarer …" disabled={disabled} className="min-h-[44px]" />
          {list.length > 0 && (
            <ul className="space-y-1" aria-label={q.trim() ? "Treff" : "Forslag"}>
              {list.map((c) => {
                const on = pick?.id === c.id;
                const isSug = !q.trim() && suggestions.some((s) => s.id === c.id);
                return (
                  <li key={c.id}>
                    <button type="button" disabled={disabled} aria-pressed={on} onClick={() => { onPick(on ? null : c); setQ(""); }}
                      className={cn("flex min-h-[44px] w-full items-center gap-2 rounded-lg border px-3 text-left text-sm", on ? "border-success/40 bg-success/10" : "border-line-subtle bg-card hover:bg-muted")}>
                      {on ? <Check className="h-4 w-4 shrink-0 text-success" aria-hidden /> : <span className="w-4" aria-hidden />}
                      <span className="font-semibold">{c.name}</span>
                      <span className="text-ink-secondary">· {TYPE_LABEL[c.item_type ?? "ravare"] ?? "Vare"}{c.base_unit ? ` · regnes i ${c.base_unit}` : ""}</span>
                      {isSug && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-caption font-semibold text-warning">{suggestionLabel}</span>}
                      <span className="ml-auto tabular-nums text-ink-secondary">{kr(c.cost, c.base_unit)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {q.trim() && hits.length === 0 && <p className="text-caption text-ink-secondary">Ingen treff. Velg «Opprett som ny» hvis varen ikke finnes.</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-n`} className="sr-only">Navn på ny vare</label>
          <Input id={`${id}-n`} value={name} onChange={(e) => onName(e.target.value)} disabled={disabled} className="min-h-[44px] min-w-[12rem] flex-1" />
          <div role="radiogroup" aria-label="Varetype" className="flex flex-wrap gap-1.5">
            {NEW_ITEM_TYPES.map((t) => (
              <Button key={t} type="button" role="radio" aria-checked={type === t} variant="outline" disabled={disabled} onClick={() => onType(t)}
                className={cn("min-h-[44px]", type === t && "border-foreground bg-muted font-semibold")}>{NEW_ITEM_TYPE_LABEL[t]}</Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

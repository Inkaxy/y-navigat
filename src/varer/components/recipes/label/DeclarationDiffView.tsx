import { cn } from "@/lib/utils";
import { nutritionDiff, wordDiff } from "@/varer/lib/declarationDiff";
import { stripHtml } from "@/varer/lib/effectiveDeclaration";

export interface DeclarationDoc {
  ingredientText: string | null;
  contains: string[];
  mayContain: string[];
  nutrition: Record<string, number | null> | null;
}

function fmtNum(v: number | null): string {
  return v == null ? "—" : String(v).replace(".", ",");
}

function setDiff(from: string[], to: string[]) {
  const norm = (s: string) => s.trim().toLocaleLowerCase("nb");
  const f = new Set(from.map(norm));
  const t = new Set(to.map(norm));
  return {
    added: to.filter((x) => !f.has(norm(x))),
    removed: from.filter((x) => !t.has(norm(x))),
  };
}

/** Har dokumentene noen forskjell i tekst, allergener eller næring? */
export function declarationDocsDiffer(a: DeclarationDoc | null, b: DeclarationDoc | null): boolean {
  if (!a || !b) return a !== b;
  if (stripHtml(a.ingredientText ?? "").trim() !== stripHtml(b.ingredientText ?? "").trim()) return true;
  const c = setDiff(a.contains, b.contains);
  const m = setDiff(a.mayContain, b.mayContain);
  if (c.added.length || c.removed.length || m.added.length || m.removed.length) return true;
  return nutritionDiff(a.nutrition, b.nutrition).some((r) => r.changed);
}

interface Props {
  from: DeclarationDoc | null;
  to: DeclarationDoc;
  fromLabel: string;
  toLabel: string;
}

/** Ord-, allergen- og næringsdiff mellom to deklarasjoner. */
export function DeclarationDiffView({ from, to, fromLabel, toLabel }: Props) {
  const parts = wordDiff(stripHtml(from?.ingredientText ?? ""), stripHtml(to.ingredientText ?? ""));
  const nutRows = nutritionDiff(from?.nutrition ?? null, to.nutrition).filter((r) => r.changed);
  const contains = setDiff(from?.contains ?? [], to.contains);
  const may = setDiff(from?.mayContain ?? [], to.mayContain);
  const allergenLines = [
    ...contains.added.map((a) => `Inneholder: + ${a}`),
    ...contains.removed.map((a) => `Inneholder: − ${a}`),
    ...may.added.map((a) => `Kan inneholde spor av: + ${a}`),
    ...may.removed.map((a) => `Kan inneholde spor av: − ${a}`),
  ];

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Fra <b>{fromLabel}</b> til <b>{toLabel}</b>. Grønt legges til, rødt fjernes.
      </p>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Ingrediensliste</div>
        {parts.every((p) => p.op === "same") ? (
          <p className="text-xs text-muted-foreground">Ingen endring i teksten.</p>
        ) : (
          <p className="leading-relaxed">
            {parts.map((p, i) => (
              <span
                key={i}
                className={cn(
                  p.op === "added" && "rounded bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
                  p.op === "removed" && "rounded bg-destructive/15 text-destructive line-through",
                )}
              >
                {p.text}
              </span>
            ))}
          </p>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Allergener</div>
        {allergenLines.length === 0 ? (
          <p className="text-xs text-muted-foreground">Ingen endring i allergenene.</p>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {allergenLines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Næring per 100 g</div>
        {nutRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Ingen endring i næringstallene.</p>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {nutRows.map((r) => (
              <li key={r.key}>
                {r.label}: <span className="text-destructive line-through">{fmtNum(r.from)}</span>{" "}
                <span className="text-emerald-700 dark:text-emerald-300">→ {fmtNum(r.to)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

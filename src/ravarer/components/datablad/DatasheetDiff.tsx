import { ALLERGENS } from "@/ravarer/lib/constants";
import { diffAllergens, normalizeAllergenCode } from "@/ravarer/lib/allergenDiff";

const ALLERGEN_LABEL_BY_CODE: Record<string, string> = Object.fromEntries(ALLERGENS.map((a) => [a.value, a.label]));

/** Felles før/etter-visning for datablad (råvarekortet og masseopplastingen). */
export function BeforeAfter({ before, after, label }: { before: string | null; after: string | null | undefined; label?: string }) {
  return (
    <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
      {label && <div className="font-medium md:col-span-2">{label}</div>}
      <div>
        <div className="text-ink-secondary">I dag</div>
        <div className="rounded bg-muted px-2 py-1">{before || "—"}</div>
      </div>
      <div>
        <div className="text-ink-secondary">Fra datablad</div>
        <div className="rounded bg-muted px-2 py-1 font-medium">{after || "—"}</div>
      </div>
    </div>
  );
}

export function AllergenPreview({
  current,
  incoming,
}: {
  current: { allergen: string; presence: string }[];
  incoming: { allergen?: unknown; presence?: unknown }[];
}) {
  const diff = diffAllergens(current, incoming);
  const name = (code: string) => ALLERGEN_LABEL_BY_CODE[normalizeAllergenCode(code) ?? code] ?? code;
  if (diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0 && diff.rejected.length === 0) {
    return <p className="mt-2 text-xs text-ink-secondary">Ingen endring i allergener.</p>;
  }
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {diff.added.map((a) => (
        <li key={`a-${a.allergen}`} className="text-success">+ {name(a.allergen)} ({a.presence === "contains" ? "inneholder" : "kan inneholde spor"})</li>
      ))}
      {diff.changed.map((c) => (
        <li key={`c-${c.allergen}`}>{name(c.allergen)}: {c.from} → {c.to}</li>
      ))}
      {diff.removed.map((r) => (
        <li key={`r-${r.allergen}`} className="text-destructive">− {name(r.allergen)} fjernes</li>
      ))}
      {diff.rejected.length > 0 && (
        <li className="text-warning">Forkastet (ukjent kode): {diff.rejected.join(", ")}</li>
      )}
    </ul>
  );
}

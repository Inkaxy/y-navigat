import { Link } from "react-router-dom";
import { Check, CircleAlert, CircleDashed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CheckItem, SectionId } from "@/ravarer/lib/rawMaterialSections";

const ICON = { ok: Check, partial: CircleDashed, missing: CircleAlert } as const;
const TONE = { ok: "text-success", partial: "text-warning", missing: "text-warning" } as const;

/** Kompakt sjekkliste i toppen; hvert punkt åpner seksjonen som løser det. */
export function CompletenessStrip({ items, hrefFor }: { items: CheckItem[]; hrefFor: (s: SectionId) => string }) {
  return (
    <ul aria-label="Komplett-sjekkliste" className="flex flex-wrap gap-1.5">
      {items.map((c) => {
        const Icon = ICON[c.status];
        return (
          <li key={c.id}>
            <Link
              to={hrefFor(c.section)}
              replace
              title={c.detail}
              className={cn("inline-flex min-h-8 items-center gap-1 rounded-full border border-line-subtle px-2.5 text-caption hover:bg-muted", TONE[c.status])}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="text-foreground">{c.label}</span>
              <span className="sr-only">: {c.detail}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ChecklistCard({ items, hrefFor }: { items: CheckItem[]; hrefFor: (s: SectionId) => string }) {
  const open = items.filter((c) => c.status !== "ok");
  return (
    <Card className="space-y-3 p-5">
      <h3 className="text-base font-semibold">Datakvalitet</h3>
      {open.length === 0 ? (
        <p className="text-sm text-ink-secondary">Alt i sjekklisten er på plass.</p>
      ) : (
        <p className="text-sm text-ink-secondary">Neste handling: <Link className="text-primary underline-offset-2 hover:underline" to={hrefFor(open[0].section)} replace>{open[0].label} — {open[0].detail}</Link></p>
      )}
      <ul className="divide-y divide-line-subtle">
        {items.map((c) => {
          const Icon = ICON[c.status];
          return (
            <li key={c.id} className="flex min-h-[44px] items-center gap-3 py-1.5 text-sm">
              <Icon className={cn("h-4 w-4 shrink-0", TONE[c.status])} aria-hidden />
              <span className="font-medium">{c.label}</span>
              <span className="text-ink-secondary">{c.detail}</span>
              {c.status !== "ok" && (
                <Link className="ml-auto text-caption text-primary underline-offset-2 hover:underline" to={hrefFor(c.section)} replace>Åpne</Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

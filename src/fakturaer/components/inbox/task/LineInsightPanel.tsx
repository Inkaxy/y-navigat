import { AlertTriangle, Lightbulb } from "lucide-react";
import {
  guessLineKind,
  LINE_KIND_LABEL,
  packageFromText,
  rankedSuggestions,
  type Clarification,
  type InsightLine,
} from "@/fakturaer/lib/lineInsight";

interface Props {
  line: InsightLine;
  clarifications: Clarification[];
}

const nb = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 3 });

/** Forslag og avklaringer lest fra linjens egne felt. Ingenting lagres herfra. */
export function LineInsightPanel({ line, clarifications }: Props) {
  const kind = guessLineKind(line);
  const pkg = packageFromText(line.description);
  const ranked = line.matched_raw_material ? [] : rankedSuggestions(line);
  return (
    <div className="space-y-2" aria-label="Tolkning av linjen">
      {clarifications.map((c) => (
        <div key={c.id} role="status" className={c.blocksPrice ? "flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-caption" : "flex gap-2 rounded-md border border-line-subtle bg-muted/40 p-2 text-caption"}>
          {c.blocksPrice ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden /> : <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" aria-hidden />}
          <div>
            <p className="font-medium text-foreground">{c.blocksPrice ? c.title : `Råd: ${c.title}`}</p>
            <p className="text-ink-secondary">{c.detail}</p>
            {!c.blocksPrice && <p className="text-ink-secondary">Sperrer ikke prisen — de eksisterende kontrollene er trygge.</p>}
          </div>
        </div>
      ))}
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-caption">
        <dt className="text-ink-secondary">Linjetype (forslag)</dt>
        <dd>
          {LINE_KIND_LABEL[kind.kind]} <span className="text-ink-secondary">— {kind.reason}</span>
        </dd>
        {pkg && (
          <>
            <dt className="text-ink-secondary">Pakning i teksten</dt>
            <dd>
              «{pkg.raw}» = {nb(pkg.total)} {pkg.totalUnit}
              {pkg.count ? ` (${pkg.count} × ${nb(pkg.size)} ${pkg.sizeUnit})` : ""}{" "}
              <span className="text-ink-secondary">— forslag, ikke bekreftet</span>
            </dd>
          </>
        )}
      </dl>
      {ranked.length > 0 && (
        <div className="rounded-md border border-line-subtle p-2">
          <p className="mb-1 flex items-center gap-1.5 text-caption font-medium">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Forslag fra matchemotoren
          </p>
          <ol className="space-y-1 text-caption">
            {ranked.map((s, i) => (
              <li key={s.rawMaterialId}>
                {i + 1}. {s.name}
                <span className="text-ink-secondary">
                  {" "}— {s.reason}
                  {s.matchScorePct != null ? ` · matchscore ${s.matchScorePct} %` : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-1 text-caption text-ink-secondary">Matchscore er hvor likt teksten er varen — ikke sannsynlighet for at fakturaen er riktig.</p>
        </div>
      )}
    </div>
  );
}

import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  items?: string[];
  onUndo?: () => void;
  onNext?: () => void;
  nextLabel?: string;
};

/** Standard resultat etter en handling: hva skjedde, valgfri «Angre», og «Neste». */
export function ResultBox({ title, items = [], onUndo, onNext, nextLabel = "Neste" }: Props) {
  return (
    <div role="status" className="rounded-lg border border-success/40 bg-success/5 p-4">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{title}</p>
          {items.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
              {items.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
        </div>
      </div>
      {(onUndo || onNext) && (
        <div className="mt-3 flex justify-end gap-2">
          {onUndo && <Button variant="ghost" size="sm" onClick={onUndo}>Angre</Button>}
          {onNext && <Button size="sm" onClick={onNext}>{nextLabel}</Button>}
        </div>
      )}
    </div>
  );
}

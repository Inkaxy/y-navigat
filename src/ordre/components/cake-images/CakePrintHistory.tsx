import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { fetchPrintHistory, type CakeImagePrint } from "@/ordre/lib/cakeImages";

const KIND_LABEL: Record<CakeImagePrint["kind"], string> = {
  print: "Skrevet ut",
  reprint: "Skrevet ut på nytt",
  pdf: "PDF lastet ned",
  test: "Testark",
};

/** Utskriftshistorikk: hver utskrift er en egen linje — også PDF og testark. */
export function CakePrintHistory({ cakeImageId }: { cakeImageId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["cake-image-prints", cakeImageId],
    queryFn: () => fetchPrintHistory(cakeImageId),
  });

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <History className="h-3.5 w-3.5" />
        Utskriftshistorikk
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Henter …</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-muted-foreground">Ingen utskrifter ennå.</p>
      ) : (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {data.map((p) => (
            <li key={p.id}>
              {new Date(p.printed_at).toLocaleString("nb-NO", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · {KIND_LABEL[p.kind] ?? p.kind}
              {p.sheet ? ` · ${p.sheet}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

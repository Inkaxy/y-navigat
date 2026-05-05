import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLabelFlaggedProducts } from "../hooks/useLabelFlaggedProducts";

interface Props {
  legalEntityId: string | undefined;
}

export function LabelFlaggedProductsBar({ legalEntityId }: Props) {
  const { data, isLoading } = useLabelFlaggedProducts(legalEntityId);
  const count = data?.length ?? 0;

  return (
    <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30 px-4 py-2">
      <p className="flex-1 text-sm text-emerald-900 dark:text-emerald-100">
        {isLoading ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <>
            Det er <span className="font-semibold">{count}</span>{" "}
            {count === 1 ? "vare" : "varer"} som skal ha etikett.
          </>
        )}
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Vis etikett-flaggede varer"
            disabled={count === 0}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="px-4 py-2 border-b">
            <p className="text-sm font-semibold">Etikett-flaggede varer</p>
            <p className="text-xs text-muted-foreground">{count} totalt</p>
          </div>
          <ScrollArea className="max-h-72">
            <ul className="divide-y">
              {data?.map((p) => (
                <li key={p.id} className="px-4 py-2 text-sm flex justify-between gap-2">
                  <span className="truncate">
                    <span className="text-muted-foreground tabular-nums mr-2">
                      {p.display_number}
                    </span>
                    {p.display_name}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {p.label_mode}
                  </span>
                </li>
              ))}
              {count === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Ingen varer er flagget for etikett.
                </li>
              )}
            </ul>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}

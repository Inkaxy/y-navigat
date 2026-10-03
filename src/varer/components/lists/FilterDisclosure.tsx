import { useId, useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Sekundærfiltre som foldes sammen på mobil (under `sm`) og alltid vises fra
 * `sm`. Aktive valg vises fortsatt utenfor folden av listen selv.
 */
export function FilterDisclosure({
  search, activeCount, children, className,
}: {
  search: ReactNode;
  activeCount: number;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end", className)}>
      <div className="flex items-end gap-2 sm:contents">
        <div className="min-w-0 flex-1 sm:max-w-md">{search}</div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 gap-1.5 sm:hidden"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filtre{activeCount > 0 ? ` (${activeCount})` : ""}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </Button>
      </div>
      <div
        id={panelId}
        className={cn("grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end", open ? "grid" : "hidden")}
      >
        {children}
      </div>
    </div>
  );
}

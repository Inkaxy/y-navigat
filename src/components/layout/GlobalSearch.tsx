import { Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppTheme } from "@/providers/AppThemeProvider";
import { cn } from "@/lib/utils";

export function GlobalSearch() {
  const { appName } = useAppTheme();
  return (
    <div className="border-b border-border bg-surface">
      <div className="flex h-9 items-center px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-7 w-full max-w-md items-center gap-2 rounded-md border border-transparent px-2",
                "text-left text-sm text-muted-foreground transition-colors hover:border-border",
                "cursor-not-allowed",
              )}
              aria-label="Global søk"
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 truncate">Søk i {appName}…</span>
              <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
                ⌘K
              </kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Global søk kommer snart</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

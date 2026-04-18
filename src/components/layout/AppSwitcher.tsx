import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { useApps, type AppWithAccess } from "@/hooks/useApps";
import { useAppTheme } from "@/providers/AppThemeProvider";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  platform: "Plattform",
  analytics: "Analyse",
  finance: "Økonomi",
  hr: "HR",
  masterdata: "Stamdata",
  operations: "Drift",
  retail: "Butikk",
  public: "Publikum",
  general: "Generelt",
};

export function AppSwitcher() {
  const { appName, appCode } = useAppTheme();
  const { data: apps } = useApps();
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
    platform: true,
  });

  const grouped: Record<string, AppWithAccess[]> = {};
  (apps ?? []).forEach((a) => {
    const cat = a.category ?? "general";
    (grouped[cat] ||= []).push(a);
  });

  const buildHref = (deployUrl: string) => {
    try {
      const url = new URL(deployUrl);
      url.searchParams.set("from", appCode);
      return url.toString();
    } catch {
      return deployUrl;
    }
  };

  const toggleCategory = (cat: string) => {
    setOpenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-2 rounded-md border border-white/30 bg-white/5 px-3 py-1.5 text-sm font-semibold",
          "text-app-foreground transition-colors hover:bg-white/15 focus:outline-none",
        )}
      >
        <ShieldCheck className="h-4 w-4" />
        <span>{appName}</span>
        <ChevronDown className="h-4 w-4 opacity-80" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-80 p-0">
        <DropdownMenuLabel className="px-3 py-2">Bytt app</DropdownMenuLabel>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {Object.keys(grouped).length === 0 && (
            <DropdownMenuItem disabled>Ingen apper tilgjengelig</DropdownMenuItem>
          )}
          {Object.entries(grouped).map(([cat, list]) => {
            const isOpen = openCategories[cat] ?? false;
            const label = CATEGORY_LABELS[cat] ?? cat;
            return (
              <Collapsible
                key={cat}
                open={isOpen}
                onOpenChange={() => toggleCategory(cat)}
                className="mb-0.5"
              >
                <CollapsibleTrigger
                  className={cn(
                    "flex w-full items-center justify-between rounded-sm px-2 py-1.5",
                    "text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                    "hover:bg-accent hover:text-accent-foreground transition-colors",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        isOpen && "rotate-90",
                      )}
                    />
                    {label}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">
                    {list.length}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {list.map((a) => {
                    const isActive = a.code === appCode;
                    const isAvailable = !!a.deploy_url;
                    const disabled = !isActive && !isAvailable;
                    const isNew =
                      isAvailable &&
                      !isActive &&
                      Date.now() - new Date(a.updated_at).getTime() <
                        7 * 24 * 60 * 60 * 1000;

                    const inner = (
                      <>
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                            style={{ background: a.theme_primary_color ?? "#94a3b8" }}
                            aria-hidden
                          />
                          <span className="text-sm truncate">{a.display_name}</span>
                          {isAvailable && !isActive && (
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                          )}
                        </span>
                        {isActive ? (
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            Du er her
                          </Badge>
                        ) : isNew ? (
                          <Badge className="text-[10px] shrink-0 bg-accent text-accent-foreground">
                            Ny
                          </Badge>
                        ) : !isAvailable ? (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            Kommer snart
                          </Badge>
                        ) : null}
                      </>
                    );

                    if (isAvailable && !isActive) {
                      return (
                        <DropdownMenuItem key={a.id} asChild className="ml-4">
                          <a
                            href={buildHref(a.deploy_url!)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between gap-2 cursor-pointer"
                          >
                            {inner}
                          </a>
                        </DropdownMenuItem>
                      );
                    }

                    return (
                      <DropdownMenuItem
                        key={a.id}
                        onSelect={(e) => e.preventDefault()}
                        disabled={disabled}
                        className={cn(
                          "ml-4 flex items-center justify-between gap-2",
                          isActive && "bg-accent/60 font-semibold focus:bg-accent/60",
                          disabled && "opacity-60",
                        )}
                      >
                        {inner}
                      </DropdownMenuItem>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

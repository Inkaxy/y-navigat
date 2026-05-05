import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabConfig =
  | {
      type: "tab";
      id: string;
      label: string;
      icon: LucideIcon;
    }
  | { type: "separator"; id: string };

interface Props {
  tab: Extract<TabConfig, { type: "tab" }>;
  active: boolean;
  dirty: boolean;
  error: boolean;
  onClick: () => void;
}

export function TabNavItem({ tab, active, dirty, error, onClick }: Props) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={tab.label}
      className={cn(
        "group flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-app",
        active
          ? "bg-app/10 text-app-dark font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="hidden md:inline truncate">{tab.label}</span>
      {(error || dirty) && (
        <span
          className={cn(
            "ml-auto h-1.5 w-1.5 rounded-full shrink-0",
            error ? "bg-destructive" : "bg-muted-foreground",
          )}
          aria-label={error ? "Valideringsfeil" : "Usavete endringer"}
        />
      )}
    </button>
  );
}

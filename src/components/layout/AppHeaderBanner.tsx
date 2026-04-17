import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AppHeaderBannerProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function AppHeaderBanner({ icon: Icon, title, subtitle, actions, className }: AppHeaderBannerProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-app-pastel-border bg-app-pastel",
        className,
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1.5 bg-app" aria-hidden />
      <div className="flex items-start justify-between gap-4 py-4 pl-5 pr-4">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/70 text-foreground"
            aria-hidden
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

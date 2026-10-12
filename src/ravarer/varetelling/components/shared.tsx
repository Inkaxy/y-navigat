import type { ReactNode, SelectHTMLAttributes } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Native select med samme uttrykk som Input; 48 px på mobil. */
export function NativeSelect({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={cn("h-12 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-10", className)}
    />
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger"; title: string; children?: ReactNode }) {
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cn(
        "rounded-lg border p-4 text-sm",
        tone === "danger" ? "border-destructive/40 bg-destructive/5" : tone === "warning" ? "border-warning/40 bg-card" : "border-border bg-card",
      )}
    >
      <p className="flex items-center gap-2 font-medium">
        {tone !== "info" && <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
        {title}
      </p>
      {children && <div className="mt-1 text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Loading({ label = "Laster …" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </p>
  );
}

export function formatDateNo(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

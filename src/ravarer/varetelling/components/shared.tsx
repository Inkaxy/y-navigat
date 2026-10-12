import type { ReactNode, SelectHTMLAttributes } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PendingOp } from "../pendingStore";

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

/** Uavklart utfall: bare samme handling kan sendes på nytt (samme operasjons-ID). */
export function PendingNotice({ op, onResend }: { op: PendingOp | undefined; onResend: () => void }) {
  if (!op || op.state !== "unknown") return null;
  return (
    <Notice tone="danger" title="Forrige sending har ukjent utfall.">
      Den kan allerede være utført. Send den samme handlingen på nytt — serveren gjenkjenner den og utfører den ikke to ganger.
      <div className="mt-2"><Button variant="outline" className="min-h-[48px]" onClick={onResend}>Send samme på nytt</Button></div>
    </Notice>
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
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

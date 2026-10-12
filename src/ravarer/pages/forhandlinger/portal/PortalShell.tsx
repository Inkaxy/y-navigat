import type { FormEvent, ReactNode } from "react";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Felles ramme for de offentlige portalene: merkevarehode på papir, smal kolonne. */
export function PortalShell({ eyebrow, title, meta, status, children }: {
  eyebrow: string; title: string; meta?: ReactNode; status?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-brand-ink text-brand-cream">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="text-body font-semibold tracking-tight">Nøtterø Bakeri</span>
          <span className="text-caption opacity-80">Leverandørportal</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <div className="space-y-1">
          <p className="text-caption font-medium uppercase tracking-wide text-ink-secondary">{eyebrow}</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words font-display text-2xl font-semibold tracking-tight text-ink-primary">{title}</h1>
            {status}
          </div>
          {meta && <div className="text-body text-ink-secondary">{meta}</div>}
        </div>
        {children}
      </main>
    </div>
  );
}

export function PortalNotice({ tone, children, action }: { tone: "error" | "warning" | "info"; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cn(
        "flex flex-col gap-3 rounded-[10px] border p-3 text-body sm:flex-row sm:items-start",
        tone === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "warning" && "border-warning/40 bg-warning/10 text-ink-primary",
        tone === "info" && "border-line-subtle bg-surface-subtle text-ink-primary",
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}

export function PortalLogin({ title, hint, password, onPassword, onSubmit, loading, error }: {
  title: string; hint: string; password: string; onPassword: (v: string) => void;
  onSubmit: (e: FormEvent) => void; loading: boolean; error: string | null;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-brand-ink text-brand-cream">
        <div className="mx-auto max-w-md px-4 py-3 text-body font-semibold">Nøtterø Bakeri</div>
      </header>
      <div className="mx-auto max-w-md px-4 py-10">
        <form onSubmit={onSubmit} className="space-y-4 rounded-[10px] border border-line-subtle bg-surface-raised p-6 shadow-sm" aria-busy={loading}>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-ink-secondary" aria-hidden />
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="portal-password">Passord</Label>
            <Input id="portal-password" type="password" autoComplete="one-time-code" className="h-[44px]"
              value={password} onChange={(e) => onPassword(e.target.value)} placeholder="6 tegn" autoFocus />
          </div>
          {error && <PortalNotice tone="error">{error}</PortalNotice>}
          <Button type="submit" disabled={loading || !password} className="h-[44px] w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Logger inn" /> : "Logg inn"}
          </Button>
          <p className="text-center text-caption text-ink-secondary">{hint}</p>
        </form>
      </div>
    </div>
  );
}

/** Fast handlingslinje nederst; stables på mobil. */
export function PortalActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-3 z-10 flex flex-col-reverse gap-2 rounded-[10px] border border-line-subtle bg-surface-raised p-3 shadow-md sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}

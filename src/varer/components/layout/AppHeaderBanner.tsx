import { Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactNode } from "react";

interface AppHeaderBannerProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AppHeaderBanner({
  title = "Varer",
  subtitle = "Produktkatalogen for Nøtterø Bakeri AS",
  actions,
}: AppHeaderBannerProps) {
  return (
    <div
      className="rounded-2xl border border-line-subtle"
      style={{
        background:
          "linear-gradient(180deg, hsl(var(--bakery-cream)) 0%, hsl(var(--surface-raised) / 0.92) 100%)",
        boxShadow: "0 1px 0 0 hsl(var(--bakery-wheat) / 0.18), var(--shadow-xs)",
      }}
    >
      <div className="flex items-start justify-between gap-4 px-6 py-5">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-raised border border-line-subtle text-ink-primary">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink-primary" style={{ letterSpacing: "-0.02em" }}>
              {title}
            </h1>
            <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

export function NewProductActionButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick} size="sm" className="rounded-full">
      <Plus className="mr-1.5 h-4 w-4" />
      Ny vare
    </Button>
  );
}

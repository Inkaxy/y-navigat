import { Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppContext } from "@/varer/context/AppContext";
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
  const { app } = useAppContext();
  return (
    <div className="app-banner-gradient">
      <div className="flex items-start justify-between gap-4 px-6 py-7 text-white">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm ring-1 ring-white/25">
            <Package className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-white/80">
              {subtitle}
              {app?.description && (
                <span className="ml-2 hidden text-white/60 md:inline">
                  · {app.description}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

export function NewProductActionButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      className="bg-white text-app-dark hover:bg-white/90"
      size="sm"
    >
      <Plus className="mr-1.5 h-4 w-4" />
      Ny vare
    </Button>
  );
}

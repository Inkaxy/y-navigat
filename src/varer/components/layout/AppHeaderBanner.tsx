import { Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactNode } from "react";
import { PageHeader } from "@/components/layout/PageHeader";

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
  return <PageHeader icon={Package} title={title} subtitle={subtitle} actions={actions} />;
}

export function NewProductActionButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick} size="sm" className="rounded-full">
      <Plus className="mr-1.5 h-4 w-4" />
      Ny vare
    </Button>
  );
}

import { Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactNode } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useCompany } from "@/hooks/useCompany";

interface AppHeaderBannerProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AppHeaderBanner({
  title = "Varer",
  subtitle,
  actions,
}: AppHeaderBannerProps) {
  const { data: company } = useCompany();
  const resolvedSubtitle =
    subtitle ?? (company ? `Produktkatalogen for ${company.display_name}` : "Produktkatalogen");
  return <PageHeader icon={Package} title={title} subtitle={resolvedSubtitle} actions={actions} />;
}

export function NewProductActionButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick} size="sm" className="rounded-full">
      <Plus className="mr-1.5 h-4 w-4" />
      Ny vare
    </Button>
  );
}

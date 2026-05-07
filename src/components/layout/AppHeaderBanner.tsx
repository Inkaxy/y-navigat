import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "./PageHeader";

interface AppHeaderBannerProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

/**
 * Kompatibilitets-shim. All eksisterende kode bruker AppHeaderBanner; vi
 * delegerer til PageHeader slik at hele appen får det nye sidehode-uttrykket
 * uten å endre kalle-stedene.
 */
export function AppHeaderBanner({ icon, title, subtitle, actions, className }: AppHeaderBannerProps) {
  return (
    <PageHeader
      icon={icon}
      title={title}
      subtitle={subtitle}
      actions={actions}
      className={className}
    />
  );
}

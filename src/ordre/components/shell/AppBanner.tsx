import { ShoppingCart, type LucideIcon } from "lucide-react";
import { useOrdreApp } from "@/ordre/hooks/useOrdreApp";
import { NB_LEGAL_NAME } from "@/ordre/lib/constants";
import { PageHeader } from "./PageHeader";

/**
 * AppBanner — bakoverkompatibel API; rendrer nå <PageHeader> (kompakt 48px).
 *
 * A.5.5.6 STEG 2.1 — det orange full-bredde hero-båndet er fjernet til fordel
 * for en kompakt, hvit side-header med brand-farget ikon. Alle eksisterende
 * sider (Dashbord, Ordrer, Ny ordre, OrderDetail, Tours, Matrix, CustomerOrders,
 * Placeholder) får ny stil automatisk uten å måtte endres.
 */
export function AppBanner({
  title,
  subtitle,
  actions,
  icon: Icon = ShoppingCart,
}: {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  icon?: LucideIcon;
}) {
  const { data: app } = useOrdreApp();
  const finalTitle = title ?? app?.display_name ?? "Ordre";
  const finalSubtitle = subtitle ?? `Ordremottak og ordrestyring for ${NB_LEGAL_NAME}`;

  return (
    <PageHeader
      icon={Icon}
      title={finalTitle}
      description={finalSubtitle}
      actions={actions}
    />
  );
}

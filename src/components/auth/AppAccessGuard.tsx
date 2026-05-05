import { ReactNode, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { useAccessibleApps } from "@/hooks/useAccessibleApps";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  /** apps.code som kreves for å se ruta */
  appCode: string;
  /** Visningsnavn brukt i toast hvis nektet */
  appName: string;
  children: ReactNode;
}

export function AppAccessGuard({ appCode, appName, children }: Props) {
  const { data: apps, isLoading } = useAccessibleApps();

  const hasAccess = !!apps?.some((a) => a.slug === appCode);

  useEffect(() => {
    if (!isLoading && !hasAccess) {
      toast.error(`Du har ikke tilgang til ${appName}`);
    }
  }, [isLoading, hasAccess, appName]);

  if (isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!hasAccess) return <Navigate to="/hjem" replace />;

  return <>{children}</>;
}

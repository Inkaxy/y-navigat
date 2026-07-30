import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  children: ReactNode;
  /** Valgfri tittel brukt i tomt-tilstand-meldingen. */
  title?: string;
}

/**
 * Krever at brukeren er platform-administrator (is_platform_admin RPC),
 * ikke bare medlem av appen. Brukes på admin-sider med skrivetilgang til
 * tvers av selskaper (tilganger, selskaper, outlets, stillinger, brukerdetaljer).
 */
export function PlatformAdminGuard({ children, title }: Props) {
  const { user } = useAuth();

  const { data: isAdmin, isLoading } = useQuery({
    queryKey: ["is-platform-admin", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("is_platform_admin");
      if (error) throw error;
      return Boolean(data);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldOff className="h-10 w-10 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Du har ikke tilgang</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {title ?? "Denne siden"} er kun tilgjengelig for platform-administratorer.
                Kontakt en admin hvis du tror dette er feil.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}

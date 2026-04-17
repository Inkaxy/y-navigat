import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PendingAccessScreen } from "./PendingAccessScreen";
import { Skeleton } from "@/components/ui/skeleton";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { data: profile, isLoading: profileLoading, isFetched } = useCurrentUser();

  if (loading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/login" replace />;
  if (profileLoading || !isFetched) return <FullPageSkeleton />;
  if (!profile) return <PendingAccessScreen />;

  return <>{children}</>;
}

function FullPageSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-3 px-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

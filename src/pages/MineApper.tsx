import { useEffect } from "react";
import { useApps } from "@/hooks/useApps";
import { CATEGORY_ORDER } from "@/lib/appIcons";
import { AppCard } from "@/components/AppCard";
import { Skeleton } from "@/components/ui/skeleton";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { LayoutGrid } from "lucide-react";

export default function MineApper() {
  const { data: apps, isLoading } = useApps();

  useEffect(() => {
    document.title = "Mine apper — NBHub";
  }, []);

  const grouped = (apps ?? []).reduce<Record<string, typeof apps>>((acc, a) => {
    (acc[a.category] ||= [] as any).push(a);
    return acc;
  }, {});

  const categoryOrder = Array.from(
    new Set([...CATEGORY_ORDER, ...Object.keys(grouped)]),
  );

  return (
    <div className="space-y-6">
      <AppHeaderBanner
        icon={LayoutGrid}
        title="Mine apper"
        subtitle="Full katalog over apper i NB-konsernet. Apper du ikke har tilgang til er nedtonet."
      />

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {!isLoading &&
        CATEGORY_ORDER.map((cat) => {
          const list = grouped[cat];
          if (!list?.length) return null;
          return (
            <section key={cat} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((a) => (
                  <AppCard key={a.id} app={a} />
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}

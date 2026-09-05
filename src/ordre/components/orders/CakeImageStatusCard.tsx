import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Cake, Printer, Loader2, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { signedUrl, type CakeImage, type CakeImageStatus } from "@/ordre/lib/cakeImages";
import { cn } from "@/lib/utils";
import { withResolvedLabelNumbers } from "@/ordre/lib/labelNumber";

const STATUS_LABEL: Record<CakeImageStatus, string> = {
  venter: "Venter",
  ferdig_redigert: "Ferdig redigert",
  skrevet_ut: "Skrevet ut",
};

const STATUS_STYLE: Record<CakeImageStatus, string> = {
  venter: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  ferdig_redigert:
    "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  skrevet_ut:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
};

function useCakeImagesFor(args: {
  ticketId?: string | null;
  orderId?: string | null;
}) {
  const { ticketId, orderId } = args;
  return useQuery({
    enabled: !!(ticketId || orderId),
    queryKey: ["cake-images-for", ticketId ?? null, orderId ?? null],
    queryFn: async (): Promise<CakeImage[]> => {
      const ors: string[] = [];
      if (ticketId) ors.push(`ticket_id.eq.${ticketId}`);
      if (orderId) ors.push(`order_id.eq.${orderId}`);
      if (ors.length === 0) return [];
      const { data, error } = await supabase
        .from("cake_images")
        .select("*")
        .or(ors.join(","))
        .order("created_at", { ascending: false });
      if (error) throw error;
      return withResolvedLabelNumbers((data ?? []) as CakeImage[]);
    },
    staleTime: 15_000,
  });
}

function Thumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    signedUrl(path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!url) {
    return (
      <div className="grid h-14 w-14 place-items-center rounded-md border bg-muted">
        <Cake className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt="Kakebilde"
      className="h-14 w-14 rounded-md border object-cover"
    />
  );
}

export function CakeImageStatusCard({
  ticketId,
  orderId,
  className,
}: {
  ticketId?: string | null;
  orderId?: string | null;
  className?: string;
}) {
  const { data: images = [], isLoading } = useCakeImagesFor({ ticketId, orderId });

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Laster kakebilder…
        </CardContent>
      </Card>
    );
  }

  if (images.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cake className="h-4 w-4 text-muted-foreground" />
          Kakebilder
          <Badge variant="outline" className="ml-auto text-[10px]">
            {images.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {images.map((img) => {
          const status = img.status as CakeImageStatus;
          return (
            <div
              key={img.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card p-2"
            >
              <Thumb path={img.original_path} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {img.resolved_label_number ? (
                    <span className="inline-flex items-center rounded bg-brand-ink px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-cream">
                      Etikett #{img.resolved_label_number}
                    </span>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      Mangler etikett
                    </Badge>
                  )}
                  <div className="truncate text-sm font-medium">{img.title}</div>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", STATUS_STYLE[status])}
                  >
                    {STATUS_LABEL[status]}
                    {status === "skrevet_ut" && img.print_count > 0 && (
                      <span className="ml-1">({img.print_count}×)</span>
                    )}
                  </Badge>
                  <span>Leveringsdato {img.delivery_date}</span>
                </div>
              </div>
              <Button asChild size="sm" variant="outline" className="gap-1">
                <Link to={`/ordre/kakebilder?date=${img.delivery_date}`}>
                  {status === "skrevet_ut" ? (
                    <Printer className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  )}
                  Åpne
                </Link>
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default CakeImageStatusCard;

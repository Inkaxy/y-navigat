import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ImageIcon, Pencil, Link as LinkIcon, AlertTriangle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type CakeImage, statusLabel } from "@/ordre/lib/cakeImages";
import type { CakeOrderMeta } from "@/ordre/hooks/useCakeImages";
import { LinkCakeImageOrderDialog } from "@/ordre/components/cake-images/LinkCakeImageOrderDialog";

const STATUS_TONE: Record<CakeImage["status"], string> = {
  venter: "bg-amber-100 text-amber-900 border-amber-300",
  ferdig_redigert: "bg-emerald-100 text-emerald-900 border-emerald-300",
  skrevet_ut: "bg-muted text-muted-foreground border-border",
};


export function CakeImageCard({
  image,
  thumbUrl,
  selected,
  onToggle,
  order,
}: {
  image: CakeImage;
  thumbUrl?: string;
  selected: boolean;
  onToggle: (id: string, on: boolean) => void;
  /** Ordredetaljer vises direkte i køen — bakeren skal slippe å klikke seg inn. */
  order?: CakeOrderMeta;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const missingOrder = !image.order_id;
  return (

    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition",
        selected ? "ring-2 ring-primary border-primary" : "border-border hover:border-muted-foreground/40",
      )}
    >
      <div
        className="absolute left-2 top-2 z-10 rounded-md bg-background/90 p-1 shadow"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onToggle(image.id, !!v)}
          aria-label="Velg"
        />
      </div>

      <Link
        to={`/ordre/kakebilder/editor/${image.id}`}
        className="relative block aspect-[4/3] w-full bg-muted"
      >
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt={image.title}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
        {image.status === "ferdig_redigert" && (
          <div className="absolute right-2 top-2 rounded-full bg-emerald-600 p-1 text-white shadow">
            <CheckCircle2 className="h-4 w-4" />
          </div>
        )}
      </Link>

      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {image.resolved_label_number ? (
                <span className="inline-flex items-center rounded bg-brand-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-brand-cream">
                  Etikett #{image.resolved_label_number}
                </span>
              ) : (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  Mangler etikett
                </Badge>
              )}
              <div className="truncate text-sm font-semibold" title={image.title}>
                {image.title}
              </div>
            </div>
            {image.customer_name && (
              <div className="truncate text-xs text-muted-foreground">
                {image.customer_name}
              </div>
            )}
          </div>
          <Badge
            variant="outline"
            className={cn("shrink-0 text-[10px]", STATUS_TONE[image.status])}
          >
            {statusLabel(image.status)}
          </Badge>
        </div>

        {!missingOrder && order && (
          <div className="mt-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] leading-snug">
            <div className="font-semibold">
              {order.order_number ? `Ordre ${order.order_number}` : "Ordre"}
              {order.tour_name ? ` · ${order.tour_name}` : ""}
            </div>
            {(order.customer_name || order.delivery_time) && (
              <div className="truncate text-muted-foreground">
                {[order.customer_name, order.delivery_time?.slice(0, 5)]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
          </div>
        )}

        {image.width_mm && image.height_mm ? (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {Math.round(Number(image.width_mm))} × {Math.round(Number(image.height_mm))} mm
            {image.shape === "round" ? " · rund" : ""}
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5" />
            Mangler format — kan ikke skrives ut i riktig størrelse
          </div>
        )}

        {image.quality_flag === "lav" && !image.quality_ack_at && (
          <div className="mt-1 flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-900">
            <AlertTriangle className="h-3.5 w-3.5" />
            Lav oppløsning — må bekreftes i editoren
          </div>
        )}


        {missingOrder && (
          <div className="mt-1 space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5" />
              Mangler ordrekobling
            </div>
            <p className="text-[11px] leading-snug text-amber-900/80">
              Uten ordre får bildet ikke etikettnummer og kan ikke pares med kaken.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full px-2 text-[11px]"
              onClick={() => setLinkOpen(true)}
            >
              <LinkIcon className="mr-1 h-3.5 w-3.5" />
              Koble til ordre
            </Button>
          </div>
        )}

        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {image.print_count > 0 ? `Skrevet ut ${image.print_count}×` : "—"}
          </span>
          <Button asChild variant="ghost" size="sm" className="h-7 px-2">
            <Link to={`/ordre/kakebilder/editor/${image.id}`}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Åpne
            </Link>
          </Button>
        </div>
      </div>

      {linkOpen && (
        <LinkCakeImageOrderDialog
          image={image}
          open={linkOpen}
          onOpenChange={setLinkOpen}
        />
      )}
    </div>
  );
}


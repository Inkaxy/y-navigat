import { formatKr } from "@/varer/lib/pricing";
import { Link } from "react-router-dom";
import { Check, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PRODUCT_STATUS_LABEL } from "@/varer/lib/constants";
import { LabelingBadge } from "@/varer/components/lists/LabelingBadge";
import { thumbUrl, onThumbError } from "@/varer/lib/thumbUrl";
import { CalcBadge, STATUS_BADGE, type ProductRow, type RowCtx } from "./productListColumns";

/**
 * Kompakt kort for en vare på smal skjerm. Navnet er en ekte lenke som dekker
 * hele kortet; resten er sekundærinformasjon.
 */
export function ProductListCard({ product: p, ctx, href }: { product: ProductRow; ctx: RowCtx; href: string }) {
  return (
    <div className="relative flex gap-3 p-4 transition-colors focus-within:bg-muted/40 hover:bg-muted/30">
      {p.image_url ? (
        <img src={thumbUrl(p.image_url, 48)} onError={onThumbError(p.image_url)} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded object-cover" loading="lazy" decoding="async" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">{p.display_number}</span>
          <Link
            to={href}
            data-focus-id={p.id}
            className={`truncate text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring ${p.variant_of_product_id ? "italic" : "font-medium"}`}
          >
            {p.display_name}
          </Link>
        </div>
        <div className="truncate text-caption text-muted-foreground">
          {[p.code, p.variant_label ? `Variant: ${p.variant_label}` : ctx.parent ? `Variant av ${ctx.parent.display_name}` : null, p.product_category]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={STATUS_BADGE[p.status]}>{PRODUCT_STATUS_LABEL[p.status]}</Badge>
          <LabelingBadge status={ctx.labeling} withPrefix />
          <span className="relative z-10 inline-flex items-center gap-1 text-caption text-muted-foreground">
            Kalkyle <CalcBadge readiness={ctx.readiness} costStale={!!ctx.costCache?.is_stale} />
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground tabular-nums">
          <span>{ctx.price !== undefined ? `${formatKr(ctx.price)} kr` : ctx.priceLoading ? "Laster pris" : "Ingen pris"} / {p.unit_of_sale}</span>
          {p.in_web_shop && <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" aria-hidden="true" />Nettbutikk</span>}
          {p.in_pos && <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" aria-hidden="true" />Kasse</span>}
        </div>
      </div>
    </div>
  );
}

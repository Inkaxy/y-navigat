// Varekort › Pris: egen prishopp-grense for varen (punkt 4d). Samme skrivevei som i Prishopp (rm_set_item_price_jump,
// bare godkjennere). Andre ser grensen som gjelder.
import { useFraFakturaSettings, useItemJumpLimits } from "@/ravarer/hooks/useFraFaktura";
import { ItemLimitSelect } from "@/ravarer/pages/frafaktura/ItemLimitSelect";

export function ItemPriceJumpCard({ rawMaterialId }: { rawMaterialId: string }) {
  const settings = useFraFakturaSettings();
  const limits = useItemJumpLimits();
  const s = settings.data;
  if (!s || s.pending || !limits.data) return null;
  const own = limits.data.get(rawMaterialId) ?? null;
  return (
    <section aria-labelledby={`pj-${rawMaterialId}`} className="rounded-xl border border-line-subtle bg-card px-4 py-3">
      <h3 id={`pj-${rawMaterialId}`} className="text-body font-semibold">Prishopp</h3>
      <p className="text-caption text-ink-secondary">
        En pris som endrer seg mer enn grensen vises under Fra faktura › Prishopp. {own != null ? `Denne varen har egen grense: ${own} %.` : `Grensen er den samme som for alle varer: ${s.priceJumpPct} %.`}
      </p>
      {s.canEdit && <div className="mt-2"><ItemLimitSelect rawMaterialId={rawMaterialId} current={own} companyLimit={s.priceJumpPct} /></div>}
    </section>
  );
}

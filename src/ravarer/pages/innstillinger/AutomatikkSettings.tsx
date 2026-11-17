import { useState } from "react";
import { useRavarerAccessLevel } from "@/ravarer/hooks/useRavarerAccessLevel";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { usePriceHistorySettings } from "@/ravarer/hooks/usePrislinje";
import { RulesCard } from "@/ravarer/components/automatikk/RulesCard";
import { PendingRulesCard } from "@/ravarer/components/automatikk/PendingRulesCard";
import { SkipRulesCard } from "@/ravarer/components/automatikk/SkipRulesCard";
import { AutoLogCard } from "@/ravarer/components/automatikk/AutoLogCard";
import { useAutoLog } from "@/ravarer/components/automatikk/useAutomatikk";
import { PriceHistorySettings } from "@/ravarer/components/prislinje/PriceHistorySettings";
import { FraFakturaRulesCard } from "./FraFakturaRulesCard";
import { SupplierRulesCard } from "./SupplierRulesCard";

/**
 * Innstillinger › Automatikk og regler (opprydding demo D): reglene fra den tidligere Automatikk-siden
 * (pant som følgevare, automatisk ny beregning, hopp over, regler som setninger), prisgrensen og
 * leverandørreglene fra Fra faktura, og prishistorikkens avviksgrense/periode fra Prislinje.
 */
export default function AutomatikkSettings() {
  const level = useRavarerAccessLevel().data ?? "none";
  const { canWrite, canApprove } = useInvoiceRights();
  const isAdmin = level === "admin";
  const [days, setDays] = useState(1);
  const log = useAutoLog(days);
  const ph = usePriceHistorySettings();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <FraFakturaRulesCard canApprove={canApprove} />
        <SupplierRulesCard canWrite={canWrite} />
        <RulesCard canEdit={isAdmin} />
        <PendingRulesCard canEdit={isAdmin} canWrite={canWrite} />
      </div>
      <div className="space-y-4">
        <AutoLogCard days={days} setDays={setDays} data={log.data} isError={log.isError} />
        <SkipRulesCard canWrite={canWrite} />
        <section aria-labelledby="prishistorikk-innst" className="space-y-2 rounded-2xl border border-line-subtle bg-card p-4">
          <h2 id="prishistorikk-innst" className="text-body font-semibold">Prishistorikk</h2>
          {ph.cap === true && ph.data
            ? <PriceHistorySettings key={`${ph.data.deviationPct ?? ""}|${ph.data.sinceMonths ?? ""}`} value={ph.data} canEdit={isAdmin} />
            : <p className="text-caption text-ink-secondary">{ph.cap === false ? "Avviksgrense og periode for prishistorikken venter på databaseendringen for Prislinje." : "Henter …"}</p>}
        </section>
      </div>
    </div>
  );
}

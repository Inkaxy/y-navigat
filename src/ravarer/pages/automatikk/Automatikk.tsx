import { useState } from "react";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { RAVARER_EYEBROW } from "@/ravarer/pages/hub/hubTabs";
import { useRavarerAccessLevel } from "@/ravarer/hooks/useRavarerAccessLevel";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { useDecisions } from "@/ravarer/hooks/useDecisions";
import { RulesCard } from "./RulesCard";
import { PendingRulesCard } from "./PendingRulesCard";
import { KeyMaterialsCard } from "./KeyMaterialsCard";
import { SkipRulesCard } from "./SkipRulesCard";
import { AutoLogCard } from "./AutoLogCard";
import { MorningEmailCard } from "./MorningEmailCard";
import { useAutoLog } from "./useAutomatikk";

/** Råvarer › Automatikk (variant B, B7): hva systemet gjør uten deg, og hvor grensene går. */
export default function Automatikk() {
  const level = useRavarerAccessLevel().data ?? "none";
  const { canWrite } = useInvoiceRights();
  const isAdmin = level === "admin";
  const [days, setDays] = useState(1);
  const log = useAutoLog(days);
  const day = useAutoLog(1);
  const { decisions, openCount, work } = useDecisions();
  return (
    <ModulePage eyebrow={RAVARER_EYEBROW} title="Automatikk" compact subtitle="Hva systemet gjør uten deg, og hvor grensene går. Alt som ikke er sikkert, havner hos deg.">
      <div className="grid gap-4 px-page pb-8 xl:grid-cols-2">
        <div className="space-y-4">
          <RulesCard canEdit={isAdmin} />
          <PendingRulesCard canEdit={isAdmin} canWrite={canWrite} />
          <KeyMaterialsCard canEdit={isAdmin} />
        </div>
        <div className="space-y-4">
          <AutoLogCard days={days} setDays={setDays} data={log.data} isError={log.isError} />
          <MorningEmailCard log={day.data} openCount={work.isSuccess ? openCount : null} decisions={work.isSuccess ? decisions : null} />
          <SkipRulesCard canWrite={canWrite} />
        </div>
      </div>
    </ModulePage>
  );
}

import { useMemo } from "react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import Varetelling from "@/ravarer/pages/Varetelling";
import { supabaseVtApi, VtApiContext } from "./api";
import { Stage3Context, supabaseStage3Api } from "./stage3";
import { VtScopeContext } from "./hooks";
import { VaretellingWorkspace } from "./components/VaretellingWorkspace";

/** Produksjonsinngang: ekte firma, rettigheter og Supabase. Dagstellingen er uendret. */
export default function VaretellingRoot() {
  const { legalEntityId, canWrite, accessLevel, user } = useRavarer();
  const userId = user?.id ?? null;
  const scope = useMemo(() => ({ entity: legalEntityId, userId, canWrite, canApprove: accessLevel === "approve" || accessLevel === "admin" }), [legalEntityId, userId, canWrite, accessLevel]);
  return (
    <VtApiContext.Provider value={supabaseVtApi}>
      <VtScopeContext.Provider value={scope}>
        <Stage3Context.Provider value={supabaseStage3Api}>
          <VaretellingWorkspace legacy={<Varetelling />} />
        </Stage3Context.Provider>
      </VtScopeContext.Provider>
    </VtApiContext.Provider>
  );
}

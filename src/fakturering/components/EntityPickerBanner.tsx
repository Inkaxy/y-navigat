import { Building2 } from "lucide-react";
import { useFaktureringEntity } from "@/fakturering/context/FaktureringContext";

/**
 * Vises på faktura-sider når brukerens globalt valgte selskap ikke er
 * faktura-tilgjengelig. Vi bytter ikke global kontekst automatisk — brukeren
 * må velge et faktura-selskap eksplisitt her.
 */
export function EntityPickerBanner() {
  const { needsEntitySelection, availableEntities, setActiveEntity } = useFaktureringEntity();
  if (!needsEntitySelection) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[hsl(var(--brand-bronze)/0.4)] bg-[hsl(var(--brand-bronze)/0.08)] px-4 py-3 text-sm">
      <Building2 className="h-4 w-4 text-[hsl(var(--brand-bronze))]" />
      <div className="flex-1">
        <div className="font-medium text-text-primary">Velg faktura-selskap</div>
        <div className="text-muted-foreground">
          Ditt gjeldende valgte selskap er ikke satt opp for Fakturering. Velg et selskap for å fortsette.
        </div>
      </div>
      <select
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        defaultValue=""
        onChange={(e) => e.target.value && setActiveEntity(e.target.value)}
      >
        <option value="" disabled>Velg selskap…</option>
        {availableEntities.map((e) => (
          <option key={e.id} value={e.id}>{e.legal_name}</option>
        ))}
      </select>
    </div>
  );
}

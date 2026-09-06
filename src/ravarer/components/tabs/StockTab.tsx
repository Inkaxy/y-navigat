import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { StockTrackingCard } from "@/ravarer/components/stock/StockTrackingCard";
import { ResaleSettingsCard } from "@/ravarer/components/stock/ResaleSettingsCard";
import { SellsAsSection } from "@/ravarer/components/stock/SellsAsSection";
import { UnitsAndPriceCard } from "@/ravarer/components/stock/UnitsAndPriceCard";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";

interface Props {
  rm: RawMaterialRow;
}

export function StockTab({ rm }: Props) {
  return (
    <div className="space-y-5">
      <StockTrackingCard rm={rm} />
      <ResaleSettingsCard rm={rm} />
      {rm.is_resale_item && <SellsAsSection rm={rm} />}
      <Accordion type="single" collapsible className="rounded-2xl border border-line-subtle px-4">
        <AccordionItem value="units" className="border-none">
          <AccordionTrigger className="text-base font-semibold">Avanserte enheter</AccordionTrigger>
          <AccordionContent>
            <UnitsAndPriceCard rm={rm} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

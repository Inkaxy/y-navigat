import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCompany } from "@/hooks/useCompany";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { RematchAllDialog } from "@/ravarer/components/RematchAllDialog";
import { paths } from "@/ravarer/lib/paths";

/** «Verktøy» i Fakturaer (arkiv): les på nytt, omberegning (samme dialog som innstillingene) og reberegning av kostpris. */
export function PriskontrollToolsMenu() {
  const { data: company } = useCompany();
  const { canWrite } = useInvoiceRights();
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Wrench className="h-3.5 w-3.5" aria-hidden />Verktøy<ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[240px]">
          <DropdownMenuItem asChild><Link to={paths.lesPaNyttBolk()}>Les fakturaer på nytt</Link></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen(true)}>Beregn alle åpne på nytt …</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link to={paths.reberegn()}>Reberegn kostpriser</Link></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RematchAllDialog open={open} onOpenChange={setOpen} legalEntityId={company?.id ?? null} canWrite={canWrite} />
    </>
  );
}

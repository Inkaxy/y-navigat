import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { paths } from "@/ravarer/lib/paths";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { SectionTabs } from "@/ravarer/ui/SectionTabs";
import { RAVARER_EYEBROW, varerTabs, type VarerTabId } from "./hubTabs";

/** Ramme for Varer-sidene: én overskrift, faneraden og verktøymenyen. */
export function VarerShell({ active, title = "Varer", children }: { active?: VarerTabId; title?: string; children: ReactNode }) {
  const { data: summary } = useWorkSummary({ includeApproval: false });
  return (
    <ModulePage
      eyebrow={RAVARER_EYEBROW}
      title={title}
      crumbs={active ? undefined : [{ label: "Varer", to: paths.varer() }, { label: title }]}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Wrench className="h-3.5 w-3.5" aria-hidden />Verktøy<ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild><Link to={paths.matvaretabellen()}>Matvaretabellen</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to={paths.databladOpplasting()}>Last opp datablad</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      tabs={active ? <SectionTabs ariaLabel="Varer" tabs={varerTabs(summary)} activeId={active} /> : undefined}
    >
      {children}
    </ModulePage>
  );
}

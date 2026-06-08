import type { ReactNode } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

interface CrudPageScaffoldProps {
  title: string;
  description: string;
  primaryAction?: string;
  onPrimaryAction?: () => void;
  /** Render-prop for senere tabell/innhold; default = tom tilstand. */
  children?: ReactNode;
}

/**
 * Skjelett for CRUD-sider. Topptittel, søk, primær-handling og innholdsslot.
 * Brukes som utgangspunkt for de 5 admin-sidene.
 */
export function CrudPageScaffold({
  title,
  description,
  primaryAction = "Ny",
  onPrimaryAction,
  children,
}: CrudPageScaffoldProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button onClick={onPrimaryAction} className="gap-2">
          <Plus className="h-4 w-4" />
          {primaryAction}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Søk…" className="pl-8" />
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        {children ?? (
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm font-medium text-foreground">Ingen data ennå</p>
            <p className="text-xs text-muted-foreground">
              Liste-implementasjon kommer i neste fase.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

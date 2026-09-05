import { Tag, Package, FileText, Ban, Printer, AlertTriangle, ChevronDown, ImageIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LabelMode, LabelPrintModel, LabelProductRow } from "../types";
import type { ProductionDepartment } from "@/produksjon/features/produksjonsavdelinger/types";
import type { LabelPrintProfile } from "@/produksjon/features/utskriftsprofiler/types";
import { useLabelFieldCatalog } from "@/produksjon/features/utskriftsprofiler/hooks/useLabelFieldCatalog";
import { formatNumberRanges, type LabelUnit } from "../hooks/useLabelUnits";
import type { LabelUnitCakeImage } from "../hooks/useLabelUnitCakeImages";

interface Props {
  rows: LabelProductRow[] | undefined;
  isLoading: boolean;
  departments: ProductionDepartment[] | undefined;
  /** Map fra product_id -> label_profile_id (eller null) */
  productProfiles?: Record<string, string | null>;
  /** Aktive profiler for valgt selskap (slik at vi kan vise navn) */
  profiles?: LabelPrintProfile[];
  /** product_id -> liste med etikettfelter som mangler verdi. */
  missingFieldsByProduct?: Record<string, string[]>;
  /** product_id -> etikett-enheter (numre) for valgt dato. */
  unitsByProduct?: Record<string, LabelUnit[]>;
  cakeImagesByUnit?: Record<string, LabelUnitCakeImage>;
  onPrint?: (row: LabelProductRow) => void;
  onPickProfile?: (row: LabelProductRow) => void;
}

const MODE_META: Record<LabelMode, { label: string; tooltip: string; icon: typeof Tag }> = {
  none: { label: "Ingen", tooltip: "Ikke etikett", icon: Ban },
  per_unit: {
    label: "per enhet",
    tooltip: "Én etikett per solgt enhet",
    icon: Tag,
  },
  per_order: {
    label: "per kundeordre",
    tooltip: "Én etikett per kundeordre (uavhengig av antall)",
    icon: Package,
  },
  per_order_or_note: {
    label: "per ordre/merknad",
    tooltip: "Én etikett per ordre (flere per merknad)",
    icon: Package,
  },
  per_note: {
    label: "per merknad",
    tooltip: "Én etikett per unik merknad",
    icon: FileText,
  },
};

const PRINT_META: Record<LabelPrintModel, { label: string; variant: "secondary" | "outline" }> = {
  standard: { label: "Standard", variant: "secondary" },
  orig_plus_copy: { label: "Orig+kopi", variant: "outline" },
};

function ModeBadge({ mode }: { mode: LabelMode }) {
  const meta = MODE_META[mode] ?? MODE_META.none;
  const Icon = meta.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="gap-1 font-normal">
          <Icon className="h-3 w-3" />
          {meta.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{meta.tooltip}</TooltipContent>
    </Tooltip>
  );
}

function NotesBadge({ notes }: { notes: string[] }) {
  if (!notes.length) return <span className="text-muted-foreground">—</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge variant="secondary" className="cursor-pointer">
          {notes.length} {notes.length === 1 ? "merknad" : "merknader"}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <p className="text-sm font-semibold mb-2">Unike merknader</p>
        <ul className="space-y-1 text-sm">
          {notes.map((n, i) => (
            <li key={i} className="text-muted-foreground">
              • {n}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function LabelProductsTable({
  rows,
  isLoading,
  departments,
  productProfiles,
  profiles,
  missingFieldsByProduct,
  unitsByProduct,
  cakeImagesByUnit,
  onPrint,
  onPickProfile,
}: Props) {
  const deptByCode = new Map(departments?.map((d) => [d.id, d]) ?? []);
  const profileById = new Map(profiles?.map((p) => [p.id, p]) ?? []);

  if (isLoading) {
    return (
      <Card>
        <div className="p-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <Card className="p-12 text-center space-y-2">
        <p className="text-lg font-semibold">Ingen etiketter for valgt dato</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Enten er ingen etikett-flaggede varer bestilt den dagen, eller
          etikett-oppsettet mangler på varene. Gå til Varer-appen for å konfigurere.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Nr</TableHead>
            <TableHead>Navn</TableHead>
            <TableHead>Etikett-nr</TableHead>
            <TableHead>Kakebilde</TableHead>
            <TableHead>Modus</TableHead>
            <TableHead>Print</TableHead>
            <TableHead>Profil</TableHead>
            <TableHead>Avdeling</TableHead>
            <TableHead className="text-right">Antall</TableHead>
            <TableHead>Merknad</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.product_id}>
              <TableCell className="tabular-nums text-muted-foreground">
                {row.display_number}
              </TableCell>
              <TableCell className="font-medium">
                <span className="inline-flex items-center gap-1.5">
                  {row.display_name}
                  <MissingFieldsBadge fields={missingFieldsByProduct?.[row.product_id]} />
                </span>
              </TableCell>
              <TableCell>
                <LabelNumbersCell units={unitsByProduct?.[row.product_id]} />
              </TableCell>
              <TableCell>
                <CakeImagesCell
                  units={unitsByProduct?.[row.product_id]}
                  imagesByUnit={cakeImagesByUnit}
                />
              </TableCell>
              <TableCell>
                <ModeBadge mode={row.label_mode} />
              </TableCell>
              <TableCell>
                <Badge variant={PRINT_META[row.label_print_model].variant}>
                  {PRINT_META[row.label_print_model].label}
                </Badge>
              </TableCell>
              <TableCell>
                <ProfilePill
                  profileId={productProfiles?.[row.product_id] ?? null}
                  profileName={
                    profileById.get(productProfiles?.[row.product_id] ?? "")?.name
                  }
                  hasAnyProfiles={(profiles?.length ?? 0) > 0}
                  onClick={() => onPickProfile?.(row)}
                />
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {row.department_ids.length === 0 && (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                  {row.department_ids.map((id) => {
                    const d = deptByCode.get(id);
                    return (
                      <Badge key={id} variant="outline" className="font-mono text-xs">
                        {d?.code ?? id.slice(0, 4)}
                      </Badge>
                    );
                  })}
                </div>
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {row.total_labels}
              </TableCell>
              <TableCell>
                <NotesBadge notes={row.unique_notes ?? []} />
              </TableCell>
              <TableCell>
                <PrintStatusCell units={unitsByProduct?.[row.product_id]} />
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => onPrint?.(row)}
                  disabled={!onPrint || row.department_ids.length === 0}
                >
                  <Printer className="h-3 w-3" />
                  Skriv ut
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function CakeImagesCell({
  units,
  imagesByUnit,
}: {
  units?: LabelUnit[];
  imagesByUnit?: Record<string, LabelUnitCakeImage>;
}) {
  const images = (units ?? [])
    .map((unit) => imagesByUnit?.[unit.id])
    .filter((image): image is LabelUnitCakeImage => Boolean(image));
  if (images.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {images.map((image) => (
        <Link
          key={image.id}
          to={`/ordre/kakebilder/editor/${image.id}`}
          className="grid h-9 w-9 place-items-center overflow-hidden rounded-md border bg-muted"
          title="Åpne kakebildet"
        >
          {image.thumb_url ? (
            <img src={image.thumb_url} alt="Kakebilde" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          )}
        </Link>
      ))}
    </div>
  );
}

function LabelNumbersCell({ units }: { units?: LabelUnit[] }) {
  if (!units || units.length === 0)
    return <span className="text-xs text-muted-foreground">—</span>;
  const active = units.filter((u) => u.status !== "cancelled");
  const cancelled = units.filter((u) => u.status === "cancelled");
  return (
    <div className="space-y-0.5">
      <span className="font-mono font-semibold tabular-nums">
        {formatNumberRanges(active.map((u) => u.number))}
      </span>
      {cancelled.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block font-mono text-xs text-muted-foreground line-through">
              {formatNumberRanges(cancelled.map((u) => u.number))}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Kansellerte etiketter — numrene blir hull i serien
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function PrintStatusCell({ units }: { units?: LabelUnit[] }) {
  const active = (units ?? []).filter((u) => u.status !== "cancelled");
  if (active.length === 0)
    return <span className="text-xs text-muted-foreground">Ikke skrevet</span>;
  const printed = active.filter((u) => u.status === "printed").length;
  if (printed === 0)
    return <span className="text-xs text-muted-foreground">Ikke skrevet</span>;
  if (printed === active.length)
    return (
      <Badge variant="secondary" className="font-normal">
        Skrevet ut
      </Badge>
    );
  return (
    <Badge variant="outline" className="font-normal">
      {printed} av {active.length} skrevet ut
    </Badge>
  );
}

function MissingFieldsBadge({ fields }: { fields?: string[] }) {
  const catalog = useLabelFieldCatalog();
  if (!fields || fields.length === 0) return null;
  const names = fields.map((k) => catalog.label(k)).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
          aria-label={`Mangler etikettinfo: ${names}`}
        >
          <AlertTriangle className="h-3 w-3" />
          Mangler
        </span>
      </TooltipTrigger>
      <TooltipContent>Mangler etikettinfo: {names}</TooltipContent>
    </Tooltip>
  );
}

function ProfilePill({
  profileId,
  profileName,
  hasAnyProfiles,
  onClick,
}: {
  profileId: string | null;
  profileName: string | undefined;
  hasAnyProfiles: boolean;
  onClick: () => void;
}) {
  if (!hasAnyProfiles) {
    return (
      <a
        href="/produksjon/innstillinger/utskriftsprofiler"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline"
      >
        Ingen profiler — opprett først
      </a>
    );
  }
  if (!profileId) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs",
          "text-muted-foreground border-amber-500/50 hover:bg-amber-500/10",
        )}
      >
        <AlertTriangle className="h-3 w-3 text-amber-500" />
        Velg profil
        <ChevronDown className="h-3 w-3" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
      title={profileName ?? "Ukjent profil"}
    >
      <span className="max-w-[140px] truncate">
        {profileName ?? "Ukjent profil"}
      </span>
      <ChevronDown className="h-3 w-3" />
    </button>
  );
}


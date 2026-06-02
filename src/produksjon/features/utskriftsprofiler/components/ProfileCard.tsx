import { useMemo } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { LabelThumbnail } from "./canvas/LabelThumbnail";
import { migrateLegacyFields } from "../lib/canvasUtils";
import { getInnerArea } from "../lib/canvasUtils";
import type { LabelPrintProfile } from "../types";

interface Props {
  profile: LabelPrintProfile;
  onEdit: () => void;
  onArchive: () => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("nb-NO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function ProfileCard({ profile, onEdit, onArchive }: Props) {
  const fields = useMemo(() => {
    const inner = getInnerArea(
      Number(profile.paper_width_mm),
      Number(profile.paper_height_mm),
      Number(profile.margin_top_mm),
      Number(profile.margin_right_mm),
      Number(profile.margin_bottom_mm),
      Number(profile.margin_left_mm),
      profile.orientation === "landscape",
    );
    return migrateLegacyFields(profile.fields, inner.w, inner.h);
  }, [profile]);

  return (
    <div
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition",
        "hover:border-primary/40 hover:shadow-md",
      )}
    >
      <button
        type="button"
        onClick={onEdit}
        className="block aspect-[3/2] w-full overflow-hidden border-b border-border bg-[hsl(var(--muted)/0.4)]"
        aria-label={`Rediger ${profile.name}`}
      >
        <div className="pointer-events-none h-full w-full">
          <LabelThumbnail
            paperWidth={Number(profile.paper_width_mm)}
            paperHeight={Number(profile.paper_height_mm)}
            marginTop={Number(profile.margin_top_mm)}
            marginRight={Number(profile.margin_right_mm)}
            marginBottom={Number(profile.margin_bottom_mm)}
            marginLeft={Number(profile.margin_left_mm)}
            landscape={profile.orientation === "landscape"}
            fields={fields}
            companyName={profile.company_name}
            logoUrl={profile.logo_url}
          />
        </div>
      </button>
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{profile.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {Number(profile.paper_width_mm)}×{Number(profile.paper_height_mm)} mm ·{" "}
            {profile.orientation === "landscape" ? "Liggende" : "Stående"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Sist endret {formatDate(profile.updated_at)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Handlinger for ${profile.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>Rediger</DropdownMenuItem>
            <DropdownMenuItem onSelect={onArchive}>Arkiver</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

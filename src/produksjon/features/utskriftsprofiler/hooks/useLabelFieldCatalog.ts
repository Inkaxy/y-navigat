import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_SIZES_FALLBACK,
  FIELD_GROUPS,
  FIELD_LABELS,
  FIELD_TYPES,
  GROUP_LABELS,
  defaultFieldSize,
  type FieldGroup,
  type FieldType,
} from "../types";

export type LabelValueType =
  | "text"
  | "date"
  | "time"
  | "number"
  | "boolean"
  | "image"
  | "barcode";

export interface LabelFieldCatalogEntry {
  field_key: string;
  display_name: string;
  field_group: FieldGroup;
  source_label: string;
  value_type: LabelValueType;
  default_width_mm: number;
  default_height_mm: number;
  multiline: boolean;
  sort_order: number;
  description: string | null;
}

export interface LabelFieldCatalog {
  entries: LabelFieldCatalogEntry[];
  byKey: Record<string, LabelFieldCatalogEntry | undefined>;
  keys: string[];
  /** Grupper i katalogens rekkefølge, med felter i sort_order. */
  groups: Array<{ group: FieldGroup; label: string; keys: string[] }>;
  label: (key: FieldType) => string;
  group: (key: FieldType) => FieldGroup;
  groupLabel: (key: FieldType) => string;
  sourceLabel: (key: FieldType) => string;
  size: (key: FieldType) => { w: number; h: number };
  isFallback: boolean;
}

const GROUP_ORDER: FieldGroup[] = [
  "bestilling",
  "kunde",
  "vare",
  "produksjon",
  "pakkseddel",
  "firma",
  "system",
];

function build(
  entries: LabelFieldCatalogEntry[],
  isFallback: boolean,
): LabelFieldCatalog {
  const byKey: Record<string, LabelFieldCatalogEntry | undefined> = {};
  for (const e of entries) byKey[e.field_key] = e;

  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    label: GROUP_LABELS[g],
    keys: entries.filter((e) => e.field_group === g).map((e) => e.field_key),
  })).filter((g) => g.keys.length > 0);

  const label = (key: FieldType) =>
    byKey[key]?.display_name ?? FIELD_LABELS[key] ?? key;
  const group = (key: FieldType): FieldGroup =>
    byKey[key]?.field_group ?? FIELD_GROUPS[key] ?? "system";

  return {
    entries,
    byKey,
    keys: entries.map((e) => e.field_key),
    groups,
    label,
    group,
    groupLabel: (key) => GROUP_LABELS[group(key)] ?? "",
    sourceLabel: (key) =>
      byKey[key]?.source_label ?? `${GROUP_LABELS[group(key)]} → ${label(key)}`,
    size: (key) => {
      const e = byKey[key];
      if (e) {
        return {
          w: Number(e.default_width_mm) || defaultFieldSize(key).w,
          h: Number(e.default_height_mm) || defaultFieldSize(key).h,
        };
      }
      return defaultFieldSize(key);
    },
    isFallback,
  };
}

/** Reservekatalog fra de gamle hardkodede konstantene. */
export const FALLBACK_CATALOG: LabelFieldCatalog = build(
  (FIELD_TYPES as readonly string[]).map((key, idx) => {
    const g = FIELD_GROUPS[key] ?? "system";
    const size = DEFAULT_SIZES_FALLBACK[key] ?? { w: 40, h: 5 };
    return {
      field_key: key,
      display_name: FIELD_LABELS[key] ?? key,
      field_group: g,
      source_label: `${GROUP_LABELS[g]} → ${FIELD_LABELS[key] ?? key}`,
      value_type:
        key === "logo"
          ? "image"
          : key === "strekkode"
            ? "barcode"
            : ("text" as LabelValueType),
      default_width_mm: size.w,
      default_height_mm: size.h,
      multiline: false,
      sort_order: (idx + 1) * 10,
      description: null,
    };
  }),
  true,
);

export function useLabelFieldCatalog(): LabelFieldCatalog {
  const { data } = useQuery({
    queryKey: ["label_field_catalog"],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<LabelFieldCatalogEntry[]> => {
      const { data, error } = await supabase
        .from("label_field_catalog")
        .select(
          "field_key, display_name, field_group, source_label, value_type, default_width_mm, default_height_mm, multiline, sort_order, description",
        )
        .eq("status", "active")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        field_key: r.field_key as string,
        display_name: (r.display_name as string) ?? (r.field_key as string),
        field_group: (r.field_group as FieldGroup) ?? "system",
        source_label: (r.source_label as string) ?? "",
        value_type: (r.value_type as LabelValueType) ?? "text",
        default_width_mm: Number(r.default_width_mm) || 40,
        default_height_mm: Number(r.default_height_mm) || 5,
        multiline: Boolean(r.multiline),
        sort_order: Number(r.sort_order) || 0,
        description: (r.description as string | null) ?? null,
      }));
    },
  });

  return useMemo(
    () => (data && data.length > 0 ? build(data, false) : FALLBACK_CATALOG),
    [data],
  );
}

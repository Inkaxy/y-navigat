import { useMemo, useState } from "react";
import {
  Search,
  User,
  Truck,
  MapPin,
  Route,
  UserCircle,
  Package,
  Hash,
  Tag,
  Sparkles,
  Type,
  Flower2,
  Cookie,
  FileText,
  MessageSquare,
  StickyNote,
  Building2,
  Image as ImageIcon,
  Info,
  Barcode,
  Clock,
  ListOrdered,
  Calendar,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  FIELD_GROUPS,
  FIELD_LABELS,
  FIELD_TYPES,
  GROUP_LABELS,
  type FieldType,
  type FieldGroup,
} from "../../types";

interface Props {
  activeFieldTypes: Set<FieldType>;
  onDragStartField: (type: FieldType) => void;
  onClickField: (type: FieldType) => void;
}

const GROUP_ORDER: FieldGroup[] = [
  "system",
  "bestilling",
  "vare",
  "pakkseddel",
  "firma",
];

const FIELD_ICONS: Record<FieldType, React.ComponentType<{ className?: string }>> = {
  etikett_nr: ListOrdered,
  strekkode: Barcode,
  sist_endret: Clock,
  kundenavn: User,
  bestilt_av: UserCircle,
  distribusjon: Truck,
  kjorerute: Route,
  tur: Route,
  leveringsadresse: MapPin,
  varenr: Hash,
  varenavn: Tag,
  antall: Package,
  fyll: Sparkles,
  tekst: Type,
  pynt: Flower2,
  sukkerbilde: Cookie,
  hentested: MapPin,
  pakkseddelnr: FileText,
  melding_pakkseddel: MessageSquare,
  kommentar: StickyNote,
  logo: ImageIcon,
  firmanavn: Building2,
  firmamerknad: Info,
  telefon: User,
  leveringsdato: Calendar,
};

const NEW_FIELDS: ReadonlySet<FieldType> = new Set(["etikett_nr"]);

export function FieldPalette({
  activeFieldTypes,
  onDragStartField,
  onClickField,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FIELD_TYPES.slice();
    return FIELD_TYPES.filter((t) =>
      FIELD_LABELS[t].toLowerCase().includes(q),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const groups: Record<FieldGroup, FieldType[]> = {
      bestilling: [],
      vare: [],
      pakkseddel: [],
      firma: [],
      system: [],
    };
    for (const t of filtered) {
      groups[FIELD_GROUPS[t]].push(t);
    }
    return groups;
  }, [filtered]);

  return (
    <div className="flex h-full flex-col border-r border-border bg-muted/20">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Søk felt …"
            className="h-9 pl-8"
          />
        </div>
        <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
          Dra felt over på etiketten, eller klikk for å legge til.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {GROUP_ORDER.map((g) => {
          const items = grouped[g];
          if (items.length === 0) return null;
          return (
            <div key={g} className="mb-3">
              <h4 className="mb-1 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {GROUP_LABELS[g]}
              </h4>
              <div className="grid grid-cols-2 gap-1">
                {items.map((type) => {
                  const active = activeFieldTypes.has(type);
                  const Icon = FIELD_ICONS[type];
                  const isNew = NEW_FIELDS.has(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      draggable={!active}
                      onDragStart={(e) => {
                        if (active) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.setData("text/x-field-type", type);
                        e.dataTransfer.effectAllowed = "copy";
                        onDragStartField(type);
                      }}
                      onClick={() => {
                        if (!active) onClickField(type);
                      }}
                      disabled={active}
                      title={FIELD_LABELS[type]}
                      className={cn(
                        "group relative flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs transition",
                        active
                          ? "cursor-default border-dashed border-border/60 bg-transparent text-muted-foreground/60"
                          : "cursor-grab border-border/60 bg-card hover:border-primary/50 hover:bg-accent active:cursor-grabbing",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          active ? "text-muted-foreground/50" : "text-muted-foreground",
                        )}
                      />
                      <span className="truncate">{FIELD_LABELS[type]}</span>
                      {isNew && !active && (
                        <span className="ml-auto shrink-0 rounded-sm bg-primary px-1 text-[8px] font-bold uppercase leading-tight text-primary-foreground">
                          Ny
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            Ingen felt matcher «{query}».
          </p>
        )}
      </div>
    </div>
  );
}

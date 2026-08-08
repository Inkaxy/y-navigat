import {
  Barcode,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Cookie,
  FileText,
  Flower2,
  Hash,
  Image as ImageIcon,
  Info,
  ListOrdered,
  MapPin,
  MessageSquare,
  Package,
  Route,
  Sparkles,
  StickyNote,
  Tag,
  Truck,
  Type,
  User,
  UserCircle,
  Factory,
} from "lucide-react";
import type { FieldGroup, FieldType } from "../types";

type IconCmp = React.ComponentType<{ className?: string }>;

const BY_KEY: Record<string, IconCmp> = {
  etikett_nr: ListOrdered,
  strekkode: Barcode,
  sist_endret: Clock,
  utskriftstidspunkt: Clock,
  kundenavn: User,
  kundenr: Hash,
  kunde_orgnr: Hash,
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
  hentetidspunkt: Clock,
  er_betalt: CheckCircle2,
};

const BY_GROUP: Record<FieldGroup, IconCmp> = {
  bestilling: FileText,
  kunde: User,
  vare: Tag,
  produksjon: Factory,
  pakkseddel: FileText,
  firma: Building2,
  system: Info,
};

/** Ikon for et felt — nøkkel-spesifikt hvis vi har et, ellers gruppens ikon. */
export function fieldIcon(key: FieldType, group: FieldGroup): IconCmp {
  return BY_KEY[key] ?? BY_GROUP[group] ?? Tag;
}

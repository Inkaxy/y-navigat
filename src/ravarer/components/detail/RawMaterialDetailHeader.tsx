import { ArrowLeft, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { paths } from "@/ravarer/lib/paths";

const ITEM_TYPE_LABEL: Record<string, string> = {
  ravare: "Råvare",
  emballasje: "Emballasje",
  forbruksvare: "Forbruksvare",
  videresalg: "Videresalg",
};

interface Props {
  rm: { name: string; sku: string; base_unit: string; item_type: string; is_active: boolean };
  listSearch: string;
  canPrev: boolean;
  canNext: boolean;
  showRename: boolean;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRename: () => void;
}

/** Råvarekortets hode. Felles PageHeader stabler tittel og handlinger på mobil (lange navn forblir lesbare). */
export function RawMaterialDetailHeader({ rm, listSearch, canPrev, canNext, showRename, onBack, onPrev, onNext, onRename }: Props) {
  return (
    <PageHeader
      eyebrow={`Råvarer · ${ITEM_TYPE_LABEL[rm.item_type] ?? rm.item_type}${rm.is_active ? "" : " · Inaktiv"}`}
      title={rm.name}
      subtitle={`SKU ${rm.sku} · ${rm.base_unit}`}
      crumbs={[
        { label: "Råvarer", to: paths.varer() },
        { label: "Varer", to: `${paths.varer()}${listSearch ? `?${listSearch}` : ""}` },
        { label: rm.name },
      ]}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Tilbake
          </Button>
          <Button variant="outline" size="icon" aria-label="Forrige råvare" title="Forrige råvare ( [ )" disabled={!canPrev} onClick={onPrev}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="outline" size="icon" aria-label="Neste råvare" title="Neste råvare ( ] )" disabled={!canNext} onClick={onNext}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          {showRename && (
            <Button variant="outline" size="sm" onClick={onRename}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Endre navn
            </Button>
          )}
        </>
      }
    />
  );
}

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Save, Send, Printer } from "lucide-react";

export interface PrintProduksjonslisteOptions {
  includeCustomers: boolean;
  pageBreakPerGroup: boolean;
  traysAsDecimal: boolean;
  includeLineComments: boolean;
  hideDoughTypes: boolean;
  includeNotes: boolean;
  columnsConfirmedProduced: boolean;
  useLeadTimes: boolean;
  expandPackages: boolean;
  includeSumQty: boolean;
  includeRevenue: boolean;
  alternateRowGray: boolean;
  compactPrint: boolean;
  saveSnapshot: boolean;
  showSnapshotDiff: boolean;
}

export const DEFAULT_PRINT_PRODUKSJON_OPTIONS: PrintProduksjonslisteOptions = {
  includeCustomers: false,
  pageBreakPerGroup: true,
  traysAsDecimal: false,
  includeLineComments: false,
  hideDoughTypes: false,
  includeNotes: false,
  columnsConfirmedProduced: false,
  useLeadTimes: true,
  expandPackages: false,
  includeSumQty: false,
  includeRevenue: false,
  alternateRowGray: true,
  compactPrint: false,
  saveSnapshot: true,
  showSnapshotDiff: false,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: string;
  templateName?: string | null;
  initial: PrintProduksjonslisteOptions;
  onSaveDefaults: (o: PrintProduksjonslisteOptions) => void;
  onPrint: (o: PrintProduksjonslisteOptions) => void;
  onSend?: (o: PrintProduksjonslisteOptions) => void;
}

interface Row {
  key: keyof PrintProduksjonslisteOptions;
  label: string;
  disabled?: boolean;
}

const SECTIONS: Row[][] = [
  [
    { key: "includeCustomers", label: "Ta med kunder" },
    { key: "pageBreakPerGroup", label: "Sideskift for hver varegruppe" },
    { key: "traysAsDecimal", label: "Vis antall plater som desimaltall" },
    { key: "includeLineComments", label: "Ta med varelinje-kommentarer" },
    { key: "hideDoughTypes", label: "Skriv uten deigtyper" },
  ],
  [
    { key: "includeNotes", label: "Ta med merknader" },
  ],
  [
    { key: "columnsConfirmedProduced", label: "Ta med kolonner for bekreftet og produsert" },
    { key: "useLeadTimes", label: "Bruk ledetider" },
    { key: "expandPackages", label: "Ekspander pakker" },
    { key: "includeSumQty", label: "Ta med sum av antall" },
    { key: "includeRevenue", label: "Ta med omsetning" },
    { key: "alternateRowGray", label: "Grå bakgrunn på annenhver linje" },
  ],
  [
    { key: "compactPrint", label: "Kompakt utskrift" },
  ],
  [
    { key: "saveSnapshot", label: 'Lagre "snapshot" for sammenligning' },
    { key: "showSnapshotDiff", label: 'Vis endring fra lagret "snapshot"' },
  ],
];

export function PrintProduksjonslisteDialog({
  open,
  onOpenChange,
  summary,
  templateName,
  initial,
  onSaveDefaults,
  onPrint,
  onSend,
}: Props) {
  const [opts, setOpts] = useState<PrintProduksjonslisteOptions>(initial);
  useEffect(() => {
    if (open) setOpts(initial);
  }, [open, initial]);

  const set = (k: keyof PrintProduksjonslisteOptions, v: boolean) =>
    setOpts((o) => ({ ...o, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[95vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Skriv ut produksjonsplan</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4 pr-1">
          {/* Sammendrag */}
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            {templateName && (
              <p className="text-xs font-semibold mb-1">{templateName}</p>
            )}
            <pre className="text-xs font-mono leading-snug whitespace-pre-wrap">{summary}</pre>
          </div>

          {/* Seksjoner med skillelinjer */}
          {SECTIONS.map((section, i) => (
            <div key={i} className="space-y-2">
              {i > 0 && <div className="border-t border-border -mx-2" />}
              {section.map((row) => (
                <label
                  key={row.key}
                  className="flex items-center gap-2 text-sm cursor-pointer select-none"
                >
                  <Checkbox
                    checked={!!opts[row.key]}
                    disabled={row.disabled}
                    onCheckedChange={(v) => set(row.key, !!v)}
                  />
                  <span className={row.disabled ? "text-muted-foreground" : ""}>
                    {row.label}
                  </span>
                </label>
              ))}
              {i === SECTIONS.length - 1 && opts.showSnapshotDiff && (
                <p className="text-xs text-muted-foreground pl-6">
                  Sammenligne gjeldende plan med tidligere lagret øyeblikksbilde for å se endringer
                </p>
              )}
            </div>
          ))}
        </div>

        <DialogFooter className="border-t border-border pt-3 flex sm:justify-between gap-2">
          <Button variant="brand" onClick={() => onSaveDefaults(opts)}>
            <Save className="h-4 w-4 mr-2" />
            Lagre
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Lukk
            </Button>
            {onSend && (
              <Button variant="default" onClick={() => onSend(opts)}>
                <Send className="h-4 w-4 mr-2" />
                Send
              </Button>
            )}
            <Button variant="default" onClick={() => onPrint(opts)}>
              <Printer className="h-4 w-4 mr-2" />
              Skriv ut
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

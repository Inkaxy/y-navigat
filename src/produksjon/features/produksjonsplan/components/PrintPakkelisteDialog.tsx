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

export interface PrintPakkelisteOptions {
  perCustomer: boolean;
  sumAllRoutes: boolean;
  pageBreakPerGroup: boolean;
  pageBreakPerProduct: boolean;
  mergeProductGroups: boolean;
  includeCustomers: boolean;
  includeLineComments: boolean;
  includeInternalComments: boolean;
  includeNotes: boolean;
  includeSumQty: boolean;
  alternateRowGray: boolean;
}

export const DEFAULT_PRINT_PAKKELISTE_OPTIONS: PrintPakkelisteOptions = {
  perCustomer: false,
  sumAllRoutes: false,
  pageBreakPerGroup: true,
  pageBreakPerProduct: false,
  mergeProductGroups: false,
  includeCustomers: false,
  includeLineComments: false,
  includeInternalComments: false,
  includeNotes: false,
  includeSumQty: false,
  alternateRowGray: true,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: string;
  templateName?: string | null;
  initial: PrintPakkelisteOptions;
  onSaveDefaults: (o: PrintPakkelisteOptions) => void;
  onPrint: (o: PrintPakkelisteOptions) => void;
  onSend?: (o: PrintPakkelisteOptions) => void;
}

export function PrintPakkelisteDialog({
  open,
  onOpenChange,
  summary,
  templateName,
  initial,
  onSaveDefaults,
  onPrint,
  onSend,
}: Props) {
  const [opts, setOpts] = useState<PrintPakkelisteOptions>(initial);
  useEffect(() => {
    if (open) setOpts(initial);
  }, [open, initial]);

  const set = (k: keyof PrintPakkelisteOptions, v: boolean) =>
    setOpts((o) => ({ ...o, [k]: v }));

  // Avhengigheter mellom valgene
  // - "Sideskift for hver vare" gjelder kun for sumliste
  // - "Slå sammen varegrupper" gjelder kun for sumliste
  const isSumList = opts.sumAllRoutes;
  const sumOnlyDisabled = !isSumList;

  type Row = {
    key: keyof PrintPakkelisteOptions;
    label: string;
    disabled?: boolean;
  };

  const sections: Row[][] = [
    [
      { key: "perCustomer", label: "Skriv pakkeliste pr KUNDE" },
      { key: "sumAllRoutes", label: "Sumliste for alle kjøreruter" },
    ],
    [
      { key: "pageBreakPerGroup", label: "Sideskift for hver varegruppe" },
      {
        key: "pageBreakPerProduct",
        label: "Sideskift for hver vare (kun for sumliste)",
        disabled: sumOnlyDisabled,
      },
      {
        key: "mergeProductGroups",
        label: "Slå sammen varegrupper",
        disabled: sumOnlyDisabled,
      },
    ],
    [
      { key: "includeCustomers", label: "Ta med kunder" },
      { key: "includeLineComments", label: "Ta med varelinje-kommentarer" },
      { key: "includeInternalComments", label: "Ta med kommentar for internt bruk" },
      { key: "includeNotes", label: "Ta med merknader" },
    ],
    [
      { key: "includeSumQty", label: "Ta med sum av antall" },
      { key: "alternateRowGray", label: "Grå bakgrunn på annenhver linje" },
    ],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[95vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Skriv ut pakkeliste</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4 pr-1">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            {templateName && (
              <p className="text-xs font-semibold mb-1">{templateName}</p>
            )}
            <pre className="text-xs font-mono leading-snug whitespace-pre-wrap">{summary}</pre>
          </div>

          {sections.map((section, i) => (
            <div key={i} className="space-y-2">
              {i > 0 && <div className="border-t border-border -mx-2" />}
              {section.map((row) => (
                <label
                  key={row.key}
                  className={`flex items-center gap-2 text-sm select-none ${
                    row.disabled ? "cursor-not-allowed" : "cursor-pointer"
                  }`}
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

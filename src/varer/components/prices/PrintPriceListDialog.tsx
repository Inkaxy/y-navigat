import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatKr } from "@/varer/lib/pricing";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  priceLists: { id: string; display_name: string }[];
  /** Rader som skal med (allerede valgt). */
  rows: {
    productId: string;
    display_number: number;
    display_name: string;
    unit: string;
    main_code?: string;
    sub_code?: string;
  }[];
  /** Henter pris for (vare, prisliste). */
  getPrice: (productId: string, priceListId: string) => number | null;
  /** Dato vist i header. */
  priceDate: string;
}

export function PrintPriceListDialog({
  open,
  onOpenChange,
  priceLists,
  rows,
  getPrice,
  priceDate,
}: Props) {
  const [pickedId, setPickedId] = useState<string>(priceLists[0]?.id ?? "");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [includeNumber, setIncludeNumber] = useState(true);
  const [includeName, setIncludeName] = useState(true);
  const [includePrice, setIncludePrice] = useState(true);

  function handlePrint() {
    const pl = priceLists.find((p) => p.id === pickedId);
    if (!pl) return;
    const headers: string[] = [];
    if (includeNumber) headers.push("Varenr");
    if (includeName) headers.push("Navn");
    headers.push("Enhet");
    if (includePrice) headers.push("Pris");

    const tbody = rows
      .map((r) => {
        const cells: string[] = [];
        if (includeNumber) cells.push(`<td class="num">${r.display_number}</td>`);
        if (includeName) cells.push(`<td>${escapeHtml(r.display_name)}</td>`);
        cells.push(`<td>${escapeHtml(r.unit)}</td>`);
        if (includePrice) {
          const p = getPrice(r.productId, pl.id);
          cells.push(`<td class="num">${p != null ? formatKr(p) : "—"}</td>`);
        }
        return `<tr>${cells.join("")}</tr>`;
      })
      .join("\n");

    const html = `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8" />
<title>Prisliste ${escapeHtml(pl.display_name)}</title>
<style>
  @page { size: A4 ${orientation}; margin: 18mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #111; margin: 0; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #666; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e5e5; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { border-top: 2px solid #333; }
  @media print {
    .no-print { display: none; }
  }
  .no-print { margin-bottom: 12px; }
  button { padding: 6px 12px; font-size: 12px; cursor: pointer; }
</style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">Skriv ut</button>
    <button onclick="window.close()">Lukk</button>
  </div>
  <h1>Prisliste ${escapeHtml(pl.display_name)}</h1>
  <div class="meta">Gjelder fra ${escapeHtml(priceDate)} · ${rows.length} varer</div>
  <table>
    <thead>
      <tr>${headers
        .map((h) => `<th class="${h === "Pris" || h === "Varenr" ? "num" : ""}">${escapeHtml(h)}</th>`)
        .join("")}</tr>
    </thead>
    <tbody>
      ${tbody}
    </tbody>
  </table>
  <script>setTimeout(function(){ window.print(); }, 300);</script>
</body>
</html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Skriv ut prisliste</DialogTitle>
          <DialogDescription>
            {rows.length} valgt(e) vare(r). Åpner ny fane med utskriftsvennlig versjon.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Prisliste</Label>
            <Select value={pickedId} onValueChange={setPickedId}>
              <SelectTrigger>
                <SelectValue placeholder="Velg…" />
              </SelectTrigger>
              <SelectContent>
                {priceLists.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Format</Label>
            <RadioGroup
              value={orientation}
              onValueChange={(v) => setOrientation(v as "portrait" | "landscape")}
              className="mt-1.5 flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="portrait" /> A4 stående
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="landscape" /> A4 liggende
              </label>
            </RadioGroup>
          </div>

          <div>
            <Label>Inkluder kolonner</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={includeNumber} onChange={(e) => setIncludeNumber(e.target.checked)} /> Varenr
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={includeName} onChange={(e) => setIncludeName(e.target.checked)} /> Navn
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={includePrice} onChange={(e) => setIncludePrice(e.target.checked)} /> Pris
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            onClick={handlePrint}
            disabled={!pickedId || rows.length === 0}
            className="bg-app hover:bg-app-dark text-app-foreground"
          >
            Skriv ut
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

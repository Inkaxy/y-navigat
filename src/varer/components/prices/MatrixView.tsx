import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useAppContext } from "@/varer/context/AppContext";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatKr } from "@/varer/lib/pricing";

export type ProductRow = {
  id: string;
  display_number: number;
  display_name: string;
  unit_of_sale: string;
  is_for_sale: boolean;
  mva_rate: number;
  main_category_id: string | null;
  sub_category_id: string | null;
  main_code?: string;
  sub_code?: string;
};

export type PriceListLite = {
  id: string;
  code: string;
  display_name: string;
  is_default: boolean;
  list_number: number | null;
  price_list_type: "base" | "offer";
  prices_include_mva: boolean;
};

interface Props {
  products: ProductRow[];
  priceLists: PriceListLite[];
  /** Cellemap: `${productId}::${priceListId}` -> price (lagret i DB) */
  prices: Map<string, number>;
  /** Pending endringer som ikke er lagret enda. cellekey -> ny verdi (string for å støtte tom = slett-ikke-implementert) */
  pendingEdits: Map<string, number>;
  /** Kalt når en celle får ny verdi (Enter/Tab/blur) — oppdaterer pending state, lagrer IKKE */
  onCellChange: (productId: string, priceListId: string, value: number | null) => void;
  generalSpecialFlags: Set<string>;
  customerSpecialFlags: Map<string, string[]>;
  selectedIds: Set<string>;
  onToggleSelect: (productId: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  highlightPriceListId?: string | null;
  showInclMva?: boolean;
}

export function MatrixView({
  products,
  priceLists,
  prices,
  pendingEdits,
  onCellChange,
  generalSpecialFlags,
  customerSpecialFlags,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  highlightPriceListId,
  showInclMva = false,
}: Props) {
  const { canWrite } = useAppContext();
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);

  const allSelected = products.length > 0 && products.every((p) => selectedIds.has(p.id));
  const someSelected = !allSelected && products.some((p) => selectedIds.has(p.id));
  const headRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function cellId(productId: string, priceListId: string) {
    return `cell-${productId}-${priceListId}`;
  }

  function focusCell(productId: string, priceListId: string) {
    const el = document.getElementById(cellId(productId, priceListId)) as HTMLButtonElement | null;
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function moveFocus(productId: string, priceListId: string, dx: number, dy: number) {
    const rowIdx = products.findIndex((p) => p.id === productId);
    const colIdx = priceLists.findIndex((pl) => pl.id === priceListId);
    if (rowIdx < 0 || colIdx < 0) return;
    const nextRow = Math.min(products.length - 1, Math.max(0, rowIdx + dy));
    const nextCol = Math.min(priceLists.length - 1, Math.max(0, colIdx + dx));
    const np = products[nextRow];
    const npl = priceLists[nextCol];
    if (np && npl) focusCell(np.id, npl.id);
  }

  function commitEdit(
    productId: string,
    priceListId: string,
    raw: string,
    move?: { dx: number; dy: number; openNext?: boolean },
  ) {
    const trimmed = raw.trim();
    const key = `${productId}::${priceListId}`;
    const original = prices.get(key);
    if (trimmed !== "") {
      const num = Number(trimmed.replace(",", "."));
      if (!isNaN(num) && num >= 0) {
        if (original != null && Math.abs(original - num) < 0.0001) {
          onCellChange(productId, priceListId, null);
        } else {
          onCellChange(productId, priceListId, num);
        }
      }
    }
    setEditing(null);
    if (move) {
      const rowIdx = products.findIndex((p) => p.id === productId);
      const colIdx = priceLists.findIndex((pl) => pl.id === priceListId);
      const nextRow = Math.min(products.length - 1, Math.max(0, rowIdx + move.dy));
      const nextCol = Math.min(priceLists.length - 1, Math.max(0, colIdx + move.dx));
      const np = products[nextRow];
      const npl = priceLists[nextCol];
      if (!np || !npl) return;
      setTimeout(() => {
        if (move.openNext) {
          const k = `${np.id}::${npl.id}`;
          const pending = pendingEdits.get(k);
          const orig = prices.get(k);
          const eff = pending !== undefined ? pending : orig;
          setEditing({ key: k, value: eff != null ? String(eff) : "" });
        } else {
          focusCell(np.id, npl.id);
        }
      }, 0);
    }
  }

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    productId: string,
    priceListId: string,
  ) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(productId, priceListId, 0, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(productId, priceListId, 0, -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      moveFocus(productId, priceListId, 1, 0);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveFocus(productId, priceListId, -1, 0);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      if (!canWrite) return;
      const key = `${productId}::${priceListId}`;
      const pending = pendingEdits.get(key);
      const original = prices.get(key);
      const eff = pending !== undefined ? pending : original;
      setEditing({ key, value: eff != null ? String(eff) : "" });
    } else if (canWrite && e.key.length === 1 && /[0-9.,\-]/.test(e.key)) {
      e.preventDefault();
      const key = `${productId}::${priceListId}`;
      setEditing({ key, value: e.key });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (!canWrite) return;
      const key = `${productId}::${priceListId}`;
      setEditing({ key, value: "" });
    }
  }

  return (
    <TooltipProvider>
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-280px)]">
          <table className="border-collapse text-sm">
            <thead className="sticky top-0 z-20 bg-muted/50">
              <tr>
                <th className="sticky left-0 z-30 w-10 bg-muted/50 px-2 py-2 text-center">
                  <input
                    ref={headRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => onToggleSelectAll(e.target.checked)}
                    className="cursor-pointer"
                  />
                </th>
                <th className="bg-muted/50 px-2 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground">Hv.gr</th>
                <th className="bg-muted/50 px-2 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground">Uv.gr</th>
                <th className="bg-muted/50 px-2 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">Varenr</th>
                <th
                  className="sticky left-10 z-30 bg-muted/50 px-3 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground min-w-[220px]"
                  style={{ left: "2.5rem" }}
                >
                  Navn
                </th>
                <th className="bg-muted/50 px-2 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground">Enhet</th>
                {priceLists.map((pl) => (
                  <th
                    key={pl.id}
                    className={cn(
                      "bg-muted/50 px-3 py-2 text-right text-xs font-medium min-w-[100px] whitespace-nowrap",
                      highlightPriceListId === pl.id && "bg-app/15 text-app-dark",
                    )}
                  >
                    <div className="truncate" title={pl.display_name}>
                      {pl.display_name}
                    </div>
                    <div className="text-[10px] font-normal text-muted-foreground">
                      {pl.price_list_type === "base" ? "base" : `nr ${pl.list_number ?? "—"}`}
                      {pl.is_default && " · default"}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td
                    colSpan={6 + priceLists.length}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    Ingen varer matcher filtrene.
                  </td>
                </tr>
              ) : (
                products.map((p) => {
                  const selected = selectedIds.has(p.id);
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        "border-t border-border hover:bg-muted/20",
                        selected && "bg-app/5",
                      )}
                    >
                      <td className="sticky left-0 z-10 w-10 bg-card px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => onToggleSelect(p.id, e.target.checked)}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-2 py-1 font-mono text-xs text-muted-foreground">
                        {p.main_code ?? ""}
                      </td>
                      <td className="px-2 py-1 font-mono text-xs text-muted-foreground">
                        {p.sub_code ?? ""}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-xs text-muted-foreground">
                        <Link
                          to={`/vareliste/${p.id}`}
                          className="hover:text-app hover:underline"
                          title="Åpne varekort"
                        >
                          {p.display_number}
                        </Link>
                      </td>
                      <td
                        className="sticky left-10 z-10 bg-card px-3 py-1 font-medium min-w-[220px]"
                        style={{ left: "2.5rem" }}
                      >
                        <Link
                          to={`/vareliste/${p.id}`}
                          className="group inline-flex items-center gap-1.5 hover:text-app"
                          title="Åpne varekort"
                        >
                          <span className="hover:underline">{p.display_name}</span>
                          <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
                        </Link>
                      </td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">{p.unit_of_sale}</td>
                      {priceLists.map((pl) => {
                        const key = `${p.id}::${pl.id}`;
                        const original = prices.get(key);
                        const pending = pendingEdits.get(key);
                        const hasPending = pending !== undefined;
                        const effective = hasPending ? pending : original;
                        const displayPrice =
                          effective != null && showInclMva
                            ? effective * (1 + Number(p.mva_rate ?? 0) / 100)
                            : effective;
                        const isEditing = editing?.key === key;
                        const hasGeneral = generalSpecialFlags.has(key);
                        const customerNames = customerSpecialFlags.get(key);
                        return (
                          <td
                            key={pl.id}
                            className={cn(
                              "relative px-2 py-1 text-right tabular-nums",
                              highlightPriceListId === pl.id && "bg-app/5",
                              hasPending && "bg-warning/10",
                            )}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                type="text"
                                inputMode="decimal"
                                value={editing.value}
                                onChange={(e) => setEditing({ key, value: e.target.value })}
                                onFocus={(e) => e.currentTarget.select()}
                                onBlur={() => commitEdit(p.id, pl.id, editing.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitEdit(p.id, pl.id, editing.value, {
                                      dx: 0,
                                      dy: e.shiftKey ? -1 : 1,
                                      openNext: true,
                                    });
                                  } else if (e.key === "Tab") {
                                    e.preventDefault();
                                    commitEdit(p.id, pl.id, editing.value, {
                                      dx: e.shiftKey ? -1 : 1,
                                      dy: 0,
                                      openNext: true,
                                    });
                                  } else if (e.key === "Escape") {
                                    setEditing(null);
                                    setTimeout(() => focusCell(p.id, pl.id), 0);
                                  } else if (e.key === "ArrowDown" && e.altKey) {
                                    e.preventDefault();
                                    commitEdit(p.id, pl.id, editing.value, { dx: 0, dy: 1, openNext: true });
                                  } else if (e.key === "ArrowUp" && e.altKey) {
                                    e.preventDefault();
                                    commitEdit(p.id, pl.id, editing.value, { dx: 0, dy: -1, openNext: true });
                                  }
                                }}
                                className="ml-auto block w-20 rounded border border-app bg-background px-1.5 py-0.5 text-right text-sm outline-none"
                              />
                            ) : (
                              <button
                                id={cellId(p.id, pl.id)}
                                disabled={!canWrite}
                                onClick={() =>
                                  canWrite &&
                                  setEditing({
                                    key,
                                    value: effective != null ? String(effective) : "",
                                  })
                                }
                                onKeyDown={(e) => handleCellKeyDown(e, p.id, pl.id)}
                                className={cn(
                                  "block w-full rounded px-1.5 py-0.5 text-right focus:outline-none focus:ring-2 focus:ring-app focus:ring-offset-1",
                                  canWrite && "hover:bg-app/10 cursor-text",
                                  displayPrice == null && "text-muted-foreground/40",
                                  hasPending && "font-semibold text-warning-foreground",
                                )}
                                title={
                                  hasPending
                                    ? `Endret (ikke lagret) — original: ${original != null ? formatKr(original) : "tom"}`
                                    : canWrite
                                      ? "Enter/F2 for å redigere · piltaster for å navigere"
                                      : ""
                                }
                              >
                                {displayPrice != null ? formatKr(displayPrice) : "—"}
                              </button>
                            )}
                            {hasGeneral && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-specialprice-general" />
                                </TooltipTrigger>
                                <TooltipContent>Aktiv spesialpris</TooltipContent>
                              </Tooltip>
                            )}
                            {customerNames && customerNames.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-specialprice-customer" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  Kunde-spesialpris:
                                  <ul className="mt-1 list-disc pl-4">
                                    {customerNames.slice(0, 8).map((n, i) => (
                                      <li key={i}>{n}</li>
                                    ))}
                                    {customerNames.length > 8 && (
                                      <li>+ {customerNames.length - 8} til</li>
                                    )}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  );
}

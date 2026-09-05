import { useEffect, useState } from "react";
import type { MatrixProduct, MatrixTour } from "@/ordre/hooks/useMatrix";
import { formatNOK } from "@/ordre/lib/format";

export type FlatLineRow = {
  key: string;
  delivery_date: string;
  delivery_tour_id: string | null;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total_incl_vat: number;
  isDraft?: boolean;
  /** Alle ordre som bidrar til linjen (flere ved dublett). */
  order_ids?: string[];
  order_number?: string | null;
  /** Linjer uten tur kan ikke redigeres i matrisen. */
  readOnly?: boolean;
};

const WEEKDAYS = ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"];

function formatHeaderDate(iso: string): { weekday: string; date: string } {
  const d = new Date(iso + "T12:00:00");
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return { weekday: WEEKDAYS[d.getDay()], date: `${dd}.${mm}.${yyyy}` };
}

function QtyInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: string) => void;
}) {
  const [local, setLocal] = useState<string>(String(value));
  useEffect(() => {
    setLocal((prev) => (Number(prev.replace(",", ".")) === value ? prev : String(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={local}
      onChange={(e) => {
        const raw = e.target.value;
        const cleaned = raw.replace(",", ".");
        if (cleaned !== "" && !/^\d*\.?\d*$/.test(cleaned)) return;
        setLocal(raw);
        onChange(cleaned);
      }}
      onFocus={(e) => e.currentTarget.select()}
      className="w-16 rounded border border-input bg-background px-2 py-1 text-right text-base font-bold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

export function FlatLinesView({
  rows,
  products,
  tours,
  onQuantityChange,
  onMoveToTour,
}: {
  rows: FlatLineRow[];
  products: MatrixProduct[];
  tours: MatrixTour[];
  onQuantityChange?: (
    delivery_date: string,
    delivery_tour_id: string | null,
    product_id: string,
    value: string,
  ) => void;
  onMoveToTour?: (row: FlatLineRow) => void;
}) {
  const productById = new Map(products.map((p) => [p.id, p]));
  const tourById = new Map(tours.map((t) => [t.id, t]));

  const sorted = [...rows].sort((a, b) => {
    if (a.delivery_date !== b.delivery_date) return a.delivery_date < b.delivery_date ? -1 : 1;
    const ta = tourById.get(a.delivery_tour_id ?? "")?.tour_number ?? 0;
    const tb = tourById.get(b.delivery_tour_id ?? "")?.tour_number ?? 0;
    if (ta !== tb) return ta - tb;
    const pa = productById.get(a.product_id)?.display_number ?? 0;
    const pb = productById.get(b.product_id)?.display_number ?? 0;
    return pa - pb;
  });

  const groups = new Map<string, { date: string; tourId: string | null; rows: FlatLineRow[] }>();
  for (const r of sorted) {
    const k = `${r.delivery_date}|${r.delivery_tour_id ?? ""}`;
    if (!groups.has(k)) groups.set(k, { date: r.delivery_date, tourId: r.delivery_tour_id, rows: [] });
    groups.get(k)!.rows.push(r);
  }

  if (sorted.length === 0) {
    return (
      <div className="p-12 text-center text-muted-foreground text-sm">
        Ingen ordrelinjer i synlig periode.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {Array.from(groups.values()).map((g) => {
        const t = tourById.get(g.tourId ?? "");
        const { weekday, date } = formatHeaderDate(g.date);
        const groupTotal = g.rows.reduce((s, r) => s + r.line_total_incl_vat, 0);
        return (
          <section key={`${g.date}|${g.tourId ?? ""}`} className="space-y-2">
            <header className="px-1">
              <h3 className="text-xl font-semibold tracking-tight">
                <span className="font-bold">{weekday}</span>{" "}
                <span className="text-foreground/80">{date}</span>
                {t ? (
                  <>
                    {" "}
                    <span className="text-foreground/60">- tur</span>{" "}
                    <span className="font-bold">{t.tour_number}</span>
                  </>
                ) : (
                  <>
                    {" "}
                    <span className="text-foreground/60">- uten tur</span>
                  </>
                )}
              </h3>
              {t?.display_name && (
                <p className="mt-0.5 text-xs text-muted-foreground">{t.display_name}</p>
              )}
              {!t && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Ordrelinjer uten tur kan ikke endres her — flytt dem til en tur først.
                </p>
              )}
            </header>

            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <tbody>
                  {g.rows.map((c, idx) => {
                    const p = productById.get(c.product_id);
                    const unit = p?.sales_unit ?? "";
                    return (
                      <tr
                        key={c.key}
                        className={
                          (idx % 2 === 0 ? "bg-muted/40" : "bg-card") +
                          " border-b last:border-b-0 border-line-subtle"
                        }
                      >
                        <td className="w-[64px] px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {p?.display_number ?? ""}
                        </td>
                        <td className="px-3 py-2">
                          {p?.display_name ?? c.product_id}
                          {c.isDraft && (
                            <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                              Ulagret
                            </span>
                          )}
                        </td>
                        <td className="w-[96px] px-3 py-2 text-right">
                          {onQuantityChange ? (
                            <QtyInput
                              value={c.quantity}
                              onChange={(v) =>
                                onQuantityChange(
                                  c.delivery_date,
                                  c.delivery_tour_id,
                                  c.product_id,
                                  v,
                                )
                              }
                            />
                          ) : (
                            <span className="text-base font-bold tabular-nums">{c.quantity}</span>
                          )}
                        </td>
                        <td className="w-[60px] px-2 py-2 text-muted-foreground">{unit}</td>
                        <td className="w-[120px] px-3 py-2 text-right tabular-nums text-muted-foreground">
                          à {formatNOK(c.unit_price)} =
                        </td>
                        <td className="w-[120px] px-3 py-2 text-right tabular-nums">
                          {formatNOK(c.line_total_incl_vat)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-card">
                    <td colSpan={5} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">
                      Sum
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {formatNOK(groupTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

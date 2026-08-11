import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  useLagerBatches,
  useStockCountApply,
  type LagerItem,
  type StockCountLine,
} from "../hooks/useLager";

const nf = new Intl.NumberFormat("nb-NO");

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}.${m}.${y}`;
}

interface CountedEntry {
  stock_item_id: string;
  item_name: string;
  batch_id: string | null;
  batch_label: string | null;
  before: number;
  counted: number;
}

interface Props {
  items: LagerItem[];
  onClose: () => void;
}

export function StockCountMode({ items, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [entries, setEntries] = useState<CountedEntry[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);

  const apply = useStockCountApply();
  const total = items.length;
  const current: LagerItem | undefined = items[index];
  const { data: batches = [], isLoading: batchesLoading } = useLagerBatches(
    current?.batch_tracking ? current.id : undefined,
  );

  useEffect(() => {
    setValues({});
  }, [index]);

  useEffect(() => {
    if (apply.isError) {
      toast.error(apply.error instanceof Error ? apply.error.message : "Kunne ikke bokføre tellingen");
    }
  }, [apply.isError, apply.error]);

  const sortedBatches = useMemo(
    () => [...batches].sort((a, b) => (a.produced_on ?? "").localeCompare(b.produced_on ?? "")),
    [batches],
  );

  const goNext = (added: CountedEntry[]) => {
    setEntries((prev) => [...prev, ...added]);
    if (index + 1 >= total) setDone(true);
    else setIndex(index + 1);
  };

  const handleNext = () => {
    if (!current) return;
    const added: CountedEntry[] = [];
    if (current.batch_tracking) {
      for (const b of sortedBatches) {
        const raw = values[b.batch_id];
        if (raw === undefined || raw.trim() === "") continue;
        const n = Number(raw.replace(",", "."));
        if (!Number.isFinite(n)) continue;
        added.push({
          stock_item_id: current.id,
          item_name: current.name,
          batch_id: b.batch_id,
          batch_label: b.batch_number,
          before: b.remaining,
          counted: n,
        });
      }
    } else {
      const raw = values[current.id];
      if (raw !== undefined && raw.trim() !== "") {
        const n = Number(raw.replace(",", "."));
        if (Number.isFinite(n)) {
          added.push({
            stock_item_id: current.id,
            item_name: current.name,
            batch_id: null,
            batch_label: null,
            before: current.on_hand,
            counted: n,
          });
        }
      }
    }
    goNext(added);
  };

  const handleSkip = () => goNext([]);

  const handleApply = () => {
    const lines: StockCountLine[] = entries.map((e) =>
      e.batch_id
        ? { stock_item_id: e.stock_item_id, batch_id: e.batch_id, counted: e.counted }
        : { stock_item_id: e.stock_item_id, counted: e.counted },
    );
    apply.mutate(
      { lines, note: note.trim() || undefined },
      {
        onSuccess: (res) => {
          toast.success(
            `Telling bokført — ${nf.format(res.adjusted ?? 0)} justert, ${nf.format(res.unchanged ?? 0)} uendret`,
          );
          onClose();
        },
      },
    );
  };

  if (done) {
    const deviations = entries.filter((e) => e.counted !== e.before);
    const unchanged = entries.length - deviations.length;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Oppsummering</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {entries.length === 0 ? (
            <p className="text-base text-muted-foreground">Ingen varer ble talt.</p>
          ) : (
            <>
              {deviations.length === 0 ? (
                <p className="text-base">Ingen avvik funnet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lagervare</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead className="text-right">I systemet</TableHead>
                      <TableHead className="text-right">Talt</TableHead>
                      <TableHead className="text-right">Differanse</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deviations.map((e) => {
                      const diff = e.counted - e.before;
                      return (
                        <TableRow key={`${e.stock_item_id}-${e.batch_id ?? "sum"}`}>
                          <TableCell className="font-medium">{e.item_name}</TableCell>
                          <TableCell className="text-muted-foreground">{e.batch_label ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{nf.format(e.before)}</TableCell>
                          <TableCell className="text-right tabular-nums">{nf.format(e.counted)}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums font-semibold",
                              diff > 0 ? "text-success" : "text-destructive",
                            )}
                          >
                            {diff > 0 ? "+" : ""}
                            {nf.format(diff)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              {unchanged > 0 && (
                <p className="text-sm text-muted-foreground">{nf.format(unchanged)} uten avvik</p>
              )}
            </>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="count-note">
              Notat (valgfritt)
            </label>
            <Textarea id="count-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              className="h-16 flex-1 text-lg"
              disabled={entries.length === 0 || apply.isPending}
              onClick={handleApply}
            >
              Bokfør telling
            </Button>
            <Button className="h-16 flex-1 text-lg" variant="outline" onClick={onClose}>
              Avbryt telling
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!current) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-2xl">{current.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {current.department_name ?? "Uten avdeling"} · teller i {current.base_unit}
          </p>
        </div>
        <Badge variant="secondary" className="px-4 py-2 text-base">
          {index + 1} av {total}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {current.batch_tracking ? (
          batchesLoading ? (
            <p className="text-muted-foreground">Laster batcher …</p>
          ) : sortedBatches.length === 0 ? (
            <p className="text-muted-foreground">Ingen åpne batcher på denne lagervaren.</p>
          ) : (
            <div className="space-y-3">
              {sortedBatches.map((b) => (
                <div
                  key={b.batch_id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-4"
                >
                  <div>
                    <div className="font-mono text-base font-semibold">{b.batch_number}</div>
                    <div className="text-sm text-muted-foreground">
                      Produsert {fmtDate(b.produced_on)} · utløper {fmtDate(b.expires_on)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      I systemet: {nf.format(b.remaining)}
                    </div>
                  </div>
                  <Input
                    inputMode="numeric"
                    placeholder="Talt"
                    className="h-14 w-40 text-2xl"
                    value={values[b.batch_id] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [b.batch_id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div className="text-sm text-muted-foreground">Hele lagervaren</div>
            <Input
              inputMode="numeric"
              placeholder="Talt"
              className="h-14 w-40 text-2xl"
              value={values[current.id] ?? ""}
              onChange={(e) => setValues((p) => ({ ...p, [current.id]: e.target.value }))}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button className="h-16 flex-1 text-lg" onClick={handleNext}>
            {index + 1 >= total ? "Fullfør" : "Neste"}
          </Button>
          <Button className="h-16 flex-1 text-lg" variant="outline" onClick={handleSkip}>
            Hopp over
          </Button>
          <Button className="h-16 text-lg" variant="ghost" onClick={onClose}>
            Avbryt telling
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

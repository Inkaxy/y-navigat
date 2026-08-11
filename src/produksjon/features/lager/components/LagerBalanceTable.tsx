import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLagerBatches, type LagerItem } from "../hooks/useLager";

const nf = new Intl.NumberFormat("nb-NO");

function levelBadge(status: string) {
  if (status === "under_min") return <Badge variant="destructive">Under min</Badge>;
  if (status === "naer_min") return <Badge className="bg-warning text-warning-foreground">Nær min</Badge>;
  return <Badge variant="secondary">OK</Badge>;
}

function expiryBadge(status: string) {
  if (status === "utlopt") return <Badge variant="destructive">Utløpt</Badge>;
  if (status === "naer_utlop") return <Badge className="bg-warning text-warning-foreground">Nær utløp</Badge>;
  return null;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}.${m}.${y}`;
}

function LevelMeter({ item }: { item: LagerItem }) {
  const max = item.max_level ?? Math.max(item.min_level ?? 0, item.on_hand, 1);
  const pct = Math.max(0, Math.min(100, (item.on_hand / (max || 1)) * 100));
  const minPct = item.min_level != null && max ? Math.min(100, (item.min_level / max) * 100) : null;
  return (
    <div className="w-32 space-y-1">
      <div className="relative h-2 w-full rounded-full bg-muted">
        <div className="h-2 rounded-full bg-app" style={{ width: `${pct}%` }} />
        {minPct != null && (
          <div className="absolute top-0 h-2 w-0.5 bg-foreground/50" style={{ left: `${minPct}%` }} />
        )}
      </div>
      {item.min_level != null && (
        <div className="text-xs text-muted-foreground">min {nf.format(item.min_level)}</div>
      )}
    </div>
  );
}

function BatchRows({ item, onWaste }: { item: LagerItem; onWaste: (itemId: string, batchId: string) => void }) {
  const { data: batches = [], isLoading } = useLagerBatches(item.id);
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="text-sm text-muted-foreground">
          Laster batcher …
        </TableCell>
      </TableRow>
    );
  }
  if (batches.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="text-sm text-muted-foreground">
          Ingen batcher registrert.
        </TableCell>
      </TableRow>
    );
  }
  return (
    <>
      {batches.map((b) => (
        <TableRow key={b.batch_id} className="bg-muted/30">
          <TableCell className="pl-12 font-mono text-sm">{b.batch_number}</TableCell>
          <TableCell className="text-sm">{fmtDate(b.produced_on)}</TableCell>
          <TableCell className="text-sm">
            <span className="mr-2">{fmtDate(b.expires_on)}</span>
            {expiryBadge(b.expiry_status)}
          </TableCell>
          <TableCell className="text-sm tabular-nums">
            {nf.format(b.remaining)} av {nf.format(b.initial_quantity)}
          </TableCell>
          <TableCell colSpan={2} className="text-right">
            <Button variant="outline" className="h-11" onClick={() => onWaste(item.id, b.batch_id)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Svinnfør
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export function LagerBalanceTable({
  items,
  onWaste,
}: {
  items: LagerItem[];
  onWaste: (itemId: string, batchId?: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Beholdning nå</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lagervare</TableHead>
              <TableHead>Emner</TableHead>
              <TableHead>Nivå</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>I dag</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <TableRow
                  className={item.batch_tracking ? "cursor-pointer" : undefined}
                  onClick={() => item.batch_tracking && setExpanded(expanded === item.id ? null : item.id)}
                >
                  <TableCell className="py-4 font-medium">
                    <span className="flex items-center gap-2">
                      {item.batch_tracking ? (
                        expanded === item.id ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )
                      ) : (
                        <span className="w-4" />
                      )}
                      {item.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-3xl font-bold tabular-nums">{nf.format(item.on_hand)}</TableCell>
                  <TableCell>
                    <LevelMeter item={item} />
                  </TableCell>
                  <TableCell>{levelBadge(item.level_status)}</TableCell>
                  <TableCell className="tabular-nums">
                    <span className="text-success">+{nf.format(item.produced_today)}</span>{" "}
                    <span className="text-destructive">−{nf.format(item.out_today)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      className="h-11"
                      onClick={(e) => {
                        e.stopPropagation();
                        onWaste(item.id);
                      }}
                    >
                      Svinnfør
                    </Button>
                  </TableCell>
                </TableRow>
                {expanded === item.id && <BatchRows item={item} onWaste={(i, b) => onWaste(i, b)} />}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

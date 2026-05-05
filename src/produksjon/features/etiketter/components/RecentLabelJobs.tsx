import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  useInsertLabelPrintJob,
  useNextLabelNumber,
  useRecentLabelJobs,
  type LabelPrintJob,
} from "../hooks/useLabelPrintJobs";
import type { ProductionDepartment } from "@/produksjon/features/produksjonsavdelinger/types";

interface Props {
  deptId: string | undefined;
  department: ProductionDepartment | undefined;
}

const STATUS_META: Record<
  LabelPrintJob["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  printed: { label: "Printet", variant: "secondary" },
  reprinted: { label: "Reprintet", variant: "outline" },
  failed: { label: "Feilet", variant: "destructive" },
};

export function RecentLabelJobs({ deptId, department }: Props) {
  const { data, isLoading } = useRecentLabelJobs(deptId);
  const nextNumber = useNextLabelNumber();
  const insertJob = useInsertLabelPrintJob();

  const handleReprint = async (job: LabelPrintJob) => {
    try {
      const newNumber = await nextNumber.mutateAsync(job.production_department_id);
      await insertJob.mutateAsync({
        label_number: newNumber,
        product_id: job.product_id,
        order_line_id: job.order_line_id,
        legal_entity_id: job.legal_entity_id,
        production_department_id: job.production_department_id,
        quantity: job.quantity,
        printer_name: job.printer_name,
        status: "reprinted",
      });
      toast.success(`Reprint ${newNumber} ferdig`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Reprint feilet";
      toast.error(msg);
    }
  };

  if (!deptId) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Velg en avdeling for å se siste print-jobber.
      </Card>
    );
  }

  return (
    <Card>
      <div className="px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">
          Siste print-jobber
          {department && (
            <span className="text-muted-foreground font-normal">
              {" "}— {department.code} {department.display_name}
            </span>
          )}
        </h3>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Ingen etiketter printet for{" "}
          <span className="font-medium">
            {department?.display_name ?? "denne avdelingen"}
          </span>{" "}
          i dag. Trykk Skriv ut på en rad over for å begynne.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono">Nummer</TableHead>
              <TableHead>Produkt</TableHead>
              <TableHead className="text-right">Antall</TableHead>
              <TableHead>Tid</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-mono text-xs">
                  {job.label_number}
                </TableCell>
                <TableCell>
                  {job.product?.display_name ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {job.quantity}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(job.printed_at), {
                    addSuffix: true,
                    locale: nb,
                  })}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_META[job.status].variant}>
                    {STATUS_META[job.status].label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-xs"
                    onClick={() => handleReprint(job)}
                    disabled={nextNumber.isPending || insertJob.isPending}
                  >
                    <RotateCw className="h-3 w-3" />
                    Reprint
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

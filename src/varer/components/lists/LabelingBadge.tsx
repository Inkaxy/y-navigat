import { Badge } from "@/components/ui/badge";
import { LABELING_STATUS_LABEL, type LabelingStatus } from "@/varer/lib/labelStaleness";

const CLS: Record<LabelingStatus, string> = {
  approved: "border-success/40 text-success",
  stale: "border-warning/50 text-warning",
  missing: "border-destructive/50 text-destructive",
};

/** Merkestatus i listene — én visning for vareliste og oppskrifter. */
export function LabelingBadge({ status, withPrefix = false }: { status: LabelingStatus | null; withPrefix?: boolean }) {
  if (status === null) {
    return <Badge variant="outline" className="text-muted-foreground">Laster merking</Badge>;
  }
  return (
    <Badge variant="outline" className={CLS[status]}>
      {withPrefix ? `Merking: ${LABELING_STATUS_LABEL[status].toLowerCase()}` : LABELING_STATUS_LABEL[status]}
    </Badge>
  );
}

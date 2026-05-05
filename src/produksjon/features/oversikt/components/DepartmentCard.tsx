import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDepartmentLabelStats } from "../hooks/useDepartmentLabelStats";
import type { ProductionDepartment } from "@/produksjon/features/produksjonsavdelinger/types";

interface DepartmentCardProps {
  department: ProductionDepartment;
}

function formatRelative(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s siden`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min siden`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} t siden`;
  const days = Math.floor(hr / 24);
  return `${days} d siden`;
}

export function DepartmentCard({ department }: DepartmentCardProps) {
  const navigate = useNavigate();
  const { data, isLoading } = useDepartmentLabelStats(department.id);

  // Tick to keep relative time fresh
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-bold truncate">{department.display_name}</h3>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {department.code}
          </p>
        </div>
        <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Tag className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      <div className="space-y-2.5">
        <StatRow
          label="I dag"
          value={isLoading ? null : String(data?.todayCount ?? 0)}
        />
        <StatRow
          label="Siste 7 dager"
          value={isLoading ? null : String(data?.weekCount ?? 0)}
        />
        <StatRow
          label="Siste etikett"
          value={
            isLoading
              ? null
              : data?.lastJob
                ? `${data.lastJob.product_display_name ?? "—"} · ${formatRelative(data.lastJob.printed_at, now)}`
                : "—"
          }
          small
        />
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full justify-between mt-1"
        onClick={() => navigate("/etiketter")}
      >
        Se etiketter
        <ArrowRight className="h-4 w-4" />
      </Button>
    </Card>
  );
}

function StatRow({
  label,
  value,
  small = false,
}: {
  label: string;
  value: string | null;
  small?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </span>
      {value === null ? (
        <Skeleton className={small ? "h-4 w-32" : "h-6 w-12"} />
      ) : (
        <span
          className={
            small
              ? "text-sm text-foreground truncate max-w-[60%] text-right"
              : "text-2xl font-bold tabular-nums"
          }
          title={small ? value : undefined}
        >
          {value}
        </span>
      )}
    </div>
  );
}

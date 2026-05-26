import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, ShieldAlert, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { summarizeQa, type QaCheck, type QaSeverity } from "@/ordre/lib/qaChecks";

const ICONS: Record<QaSeverity, JSX.Element> = {
  green: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
  yellow: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
  red: <ShieldAlert className="h-4 w-4 text-destructive" />,
};

const ROW: Record<QaSeverity, string> = {
  green: "border-emerald-500/30 bg-emerald-500/5",
  yellow: "border-amber-500/30 bg-amber-500/5",
  red: "border-destructive/30 bg-destructive/5",
};

const SUMMARY_LABEL: Record<QaSeverity, string> = {
  red: "Må løses",
  yellow: "Bør sjekkes",
  green: "OK",
};

type Props = {
  title?: string;
  description?: string;
  checks: QaCheck[];
  compact?: boolean;
};

export function QaChecklistCard({ title = "Kvalitetssikring", description, checks, compact }: Props) {
  const sum = summarizeQa(checks);
  return (
    <Card>
      <CardHeader className={cn(compact ? "pb-2" : "pb-3")}>
        <CardTitle className="text-sm flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          {title}
          <div className="ml-auto flex items-center gap-1">
            {sum.red > 0 && (
              <Badge variant="outline" className={cn("text-[10px]", ROW.red)}>{sum.red} rød</Badge>
            )}
            {sum.yellow > 0 && (
              <Badge variant="outline" className={cn("text-[10px]", ROW.yellow)}>{sum.yellow} gul</Badge>
            )}
            {sum.green > 0 && (
              <Badge variant="outline" className={cn("text-[10px]", ROW.green)}>{sum.green} OK</Badge>
            )}
            {sum.severity && (
              <span className="text-[11px] text-muted-foreground ml-1">{SUMMARY_LABEL[sum.severity]}</span>
            )}
          </div>
        </CardTitle>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardHeader>
      <CardContent>
        {checks.length === 0 ? (
          <p className="text-xs text-muted-foreground">Ingen sjekker å vise.</p>
        ) : (
          <ul className={cn("grid gap-2", compact ? "" : "sm:grid-cols-2")}>
            {checks.map((c) => (
              <li key={c.id} className={cn("flex gap-2 rounded-md border p-2 text-xs", ROW[c.severity])}>
                <span className="mt-0.5 shrink-0">{ICONS[c.severity]}</span>
                <div className="space-y-0.5 min-w-0">
                  <div className="font-medium text-foreground">{c.label}</div>
                  {c.detail && (
                    <div className="text-muted-foreground break-words">{c.detail}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default QaChecklistCard;

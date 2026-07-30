import { useFormContext } from "react-hook-form";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Calendar, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductFormValues } from "@/varer/lib/productSchema";
import { osloTodayISO } from "@/lib/osloDate";

interface Props {
  canWrite: boolean;
}

export function LeveranseTab({ canWrite }: Props) {
  const { register, watch } = useFormContext<ProductFormValues>();
  const from = watch("pause_delivery_from");
  const to = watch("pause_delivery_to");

  const today = osloTodayISO();
  let banner: { tone: "destructive" | "warning" | "muted"; text: string; icon: typeof AlertCircle } | null = null;
  if (from) {
    const ended = to && to < today;
    const inFuture = from > today;
    if (ended) {
      banner = { tone: "muted", text: "Pauseperioden er avsluttet", icon: CheckCircle2 };
    } else if (inFuture) {
      banner = { tone: "warning", text: `Planlagt pause fra ${from}`, icon: Calendar };
    } else {
      banner = { tone: "destructive", text: "Varen er pauset fra leveranse", icon: AlertCircle };
    }
  }

  return (
    <div className="space-y-4">
      {banner && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border px-4 py-3 text-sm",
            banner.tone === "destructive" &&
              "border-destructive/30 bg-destructive/10 text-destructive",
            banner.tone === "warning" &&
              "border-warning/30 bg-warning/10 text-warning-foreground",
            banner.tone === "muted" && "border-border bg-muted text-muted-foreground",
          )}
        >
          <banner.icon className="h-4 w-4 shrink-0" />
          <span className="font-medium">{banner.text}</span>
        </div>
      )}

      <Card>
        <CardContent className="pt-6 grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <Label>Pause leveranse fra</Label>
              <Input type="date" {...register("pause_delivery_from")} disabled={!canWrite} />
            </div>
            <div>
              <Label>Pause leveranse til (valgfritt)</Label>
              <Input type="date" {...register("pause_delivery_to")} disabled={!canWrite} />
            </div>
            <div>
              <Label>Intern note om pausen</Label>
              <Textarea
                rows={4}
                {...register("pause_reason")}
                disabled={!canWrite}
                placeholder="Vises kun internt…"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label>Grunnen til pausen (vises til kunde)</Label>
              <Textarea
                rows={4}
                {...register("pause_reason_customer")}
                disabled={!canWrite}
                placeholder="Valgfritt — vises i nettbutikk og kundeportal"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Hvis satt, vises denne teksten til kunder som forsøker å bestille varen i pauseperioden.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

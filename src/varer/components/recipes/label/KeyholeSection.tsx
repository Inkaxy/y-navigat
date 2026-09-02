import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CheckCircle2, HelpCircle, Lock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/varer/lib/breadscale";
import { useUserDisplayName } from "@/varer/hooks/useRecipeLabel";
import { formatDateTimeNb } from "./labelShared";

export interface KeyholeCriterion {
  key: string;
  name: string;
  requirement: string;
  unit: string;
  value: number | null;
  met: boolean | null;
  /** Serveren kan sende rådet direkte på kriteriet. */
  advice?: string | null;
}

export interface KeyholeResult {
  group: string;
  group_label: string;
  group_choice_reason: string | null;
  status: "oppfylt" | "ikke_oppfylt" | "ukjent";
  status_reason: string | null;
  criteria: KeyholeCriterion[];
  advice: string[];
}

interface Props {
  keyhole: KeyholeResult | null;
  coverageOk: boolean;
  claimKeyhole: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  canWrite: boolean;
  onToggleClaim: (value: boolean) => void;
  saving: boolean;
  /** Antall primærkoblede produkter merket kopieres til. */
  primaryProductCount: number;
}

/** Matcher råd til kriterium på nøkkel — faller tilbake til navneprefiks. */
function adviceFor(c: KeyholeCriterion, advice: string[]): string | null {
  if (c.advice) return c.advice;
  const byKey = advice.find((a) => a.toLowerCase().includes(c.key.toLowerCase()));
  if (byKey) return byKey;
  return advice.find((a) => a.toLowerCase().startsWith(c.name.toLowerCase())) ?? null;
}

/** Nøkkelhullet som sjekkliste med konkrete råd, og låsbar merkebryter. */
export function KeyholeSection({
  keyhole,
  coverageOk,
  claimKeyhole,
  approvedBy,
  approvedAt,
  canWrite,
  onToggleClaim,
  saving,
  primaryProductCount,
}: Props) {
  const criteria = keyhole?.criteria ?? [];
  const advice = keyhole?.advice ?? [];
  const locked = !coverageOk || keyhole?.status !== "oppfylt";
  const approverName = useUserDisplayName(approvedBy).data;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">Nøkkelhullet</CardTitle>
        {keyhole && (
          <Badge
            variant={
              keyhole.status === "oppfylt" ? "default" : keyhole.status === "ukjent" ? "secondary" : "destructive"
            }
          >
            {keyhole.status === "oppfylt"
              ? "Kriteriene er oppfylt"
              : keyhole.status === "ukjent"
                ? "Kan ikke vurderes ennå"
                : "Kriteriene er ikke oppfylt"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!keyhole ? (
          <p className="text-sm text-muted-foreground">Ingen vurdering beregnet ennå.</p>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              <b className="text-foreground">{keyhole.group_label}</b>
              {keyhole.group_choice_reason && <> — {keyhole.group_choice_reason}</>}
            </div>

            {keyhole.status === "ukjent" && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                {keyhole.status_reason ?? "Grunnlaget er for tynt til å konkludere."}{" "}
                <a href="#mangler-naeringsdata" className="font-medium underline">
                  Se råvarene som mangler næringsdata
                </a>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              {criteria.map((c) => {
                const unknown = c.met === null;
                const tip = c.met === false ? adviceFor(c, advice) : null;
                return (
                  <div
                    key={c.key}
                    className={cn(
                      "rounded-md border p-3",
                      c.met === true && "border-emerald-600/50 bg-emerald-600/5",
                      c.met === false && "border-destructive/50 bg-destructive/5",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {unknown ? (
                        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : c.met ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{c.name}</div>
                        <div className="text-xs tabular-nums text-muted-foreground">
                          Krav: {c.requirement} · Målt: {unknown ? "ukjent" : `${fmtNum(c.value, 1)} ${c.unit}`}
                        </div>
                        {tip && <p className="mt-1.5 text-xs">{tip}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {advice.length > 0 && keyhole.status === "ikke_oppfylt" && (
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Hva må endres
                </div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {advice.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label className="flex items-center gap-1.5">
                {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                Merk produktet med Nøkkelhullet
              </Label>
              <p className="text-xs text-muted-foreground">
                {locked
                  ? "Låst til alle kriteriene er oppfylt med tilstrekkelig datadekning."
                  : "Slås på under bakeriets ansvar — hvem som godkjente blir loggført."}
              </p>
            </div>
            <Switch
              checked={claimKeyhole}
              disabled={!canWrite || saving || (locked && !claimKeyhole)}
              onCheckedChange={onToggleClaim}
            />
          </div>

          {claimKeyhole && approvedAt && (
            <p className="text-xs text-muted-foreground">
              Sist godkjent {formatDateTimeNb(approvedAt)}
              {approverName ? ` av ${approverName}` : ""}.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Merket kopieres automatisk til {primaryProductCount} primærkoblede produkter (cert_nokkelhull).
          </p>

          <p className="text-xs text-muted-foreground">
            Bruk av Nøkkelhullet er frivillig og krever ingen søknad, men kravene i nøkkelhullforskriften må være
            oppfylt. Mattilsynet fører tilsyn, og bakeriet er juridisk ansvarlig for påstanden.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CheckCircle2, HelpCircle, Lock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/varer/lib/breadscale";

export interface KeyholeCriterion {
  key: string;
  name: string;
  requirement: string;
  unit: string;
  value: number | null;
  met: boolean | null;
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
  claimGrain: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  approverName?: string | null;
  canWrite: boolean;
  onToggleClaim: (field: "label_claim_keyhole" | "label_claim_grain", value: boolean) => void;
  saving: boolean;
}

/** Nøkkelhullet som sjekkliste med konkrete råd, og låsbare merkebrytere. */
export function KeyholeSection({
  keyhole,
  coverageOk,
  claimKeyhole,
  claimGrain,
  approvedAt,
  approverName,
  canWrite,
  onToggleClaim,
  saving,
}: Props) {
  const criteria = keyhole?.criteria ?? [];
  const adviceByKey = new Map<string, string>();
  for (const a of keyhole?.advice ?? []) {
    const match = criteria.find((c) => a.startsWith(c.name));
    if (match) adviceByKey.set(match.key, a);
  }
  const locked = !coverageOk || keyhole?.status !== "oppfylt";

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
                        <div className="text-xs text-muted-foreground">
                          Krav: {c.requirement} · Målt:{" "}
                          {unknown ? "ukjent" : `${fmtNum(c.value, 1)} ${c.unit.replace("g/100 g", "g/100 g")}`}
                        </div>
                        {c.met === false && adviceByKey.get(c.key) && (
                          <p className="mt-1.5 text-xs">{adviceByKey.get(c.key)}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {keyhole.advice.length > 0 && keyhole.status === "ikke_oppfylt" && (
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Hva må endres
                </div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {keyhole.advice.map((a, i) => (
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
              onCheckedChange={(v) => onToggleClaim("label_claim_keyhole", v)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <div className="min-w-0">
              <Label>Merk produktet med grovhetsmerket</Label>
              <p className="text-xs text-muted-foreground">Brødskala'n-merket for beregnet grovhetsnivå.</p>
            </div>
            <Switch
              checked={claimGrain}
              disabled={!canWrite || saving}
              onCheckedChange={(v) => onToggleClaim("label_claim_grain", v)}
            />
          </div>

          {(claimKeyhole || claimGrain) && approvedAt && (
            <p className="text-xs text-muted-foreground">
              Godkjent {new Date(approvedAt).toLocaleString("nb-NO")}
              {approverName ? ` av ${approverName}` : ""}.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Bruk av Nøkkelhullet er frivillig og krever ingen søknad, men kravene i nøkkelhullforskriften må være
            oppfylt. Mattilsynet fører tilsyn, og bakeriet er juridisk ansvarlig for påstanden.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

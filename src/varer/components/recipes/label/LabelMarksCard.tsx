import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ExternalLink, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { GRAIN_LEVELS, fmtPct, grainCategoryFromPct } from "@/varer/lib/breadscale";
import { brodskalanFor } from "@/varer/lib/brodskalan";
import nokkelhulletSrc from "@/assets/nokkelhullet.svg";
import type { RecipeLinkedProduct } from "@/varer/hooks/useRecipeLabel";
import type { KeyholeResult } from "./KeyholeSection";

interface RowProps {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  locked: boolean;
  lockedReason: string | null;
  disabled: boolean;
  onToggle: (v: boolean) => void;
  status: ReactNode;
  mark?: ReactNode;
  children?: ReactNode;
  details: ReactNode;
}

function MarkRow(p: RowProps) {
  const [open, setOpen] = useState(false);
  const switchId = `${p.id}-bryter`;
  return (
    <div id={p.id} tabIndex={-1} className="scroll-mt-4 space-y-2 border-b border-border/60 py-3 outline-none last:border-0">
      <div className="flex items-start gap-3">
        <div className="flex min-h-11 min-w-11 items-center">
          <Switch
            id={switchId}
            checked={p.checked}
            disabled={p.disabled || (p.locked && !p.checked)}
            onCheckedChange={p.onToggle}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={switchId} className="flex min-h-11 items-center gap-1.5 text-sm font-medium">
            {p.locked && !p.checked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
            {p.title}
          </label>
          <p className="text-xs text-muted-foreground">{p.description}</p>
          {p.children}
          <div className="text-xs">{p.status}</div>
          {p.locked && !p.checked && p.lockedReason && <p className="text-xs text-destructive">{p.lockedReason}</p>}
        </div>
        {p.mark}
      </div>
      <Button type="button" variant="ghost" className="min-h-11" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Skjul detaljer" : "Vis detaljer"}
        <ChevronDown className={cn("ml-1.5 h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      </Button>
      {/* Alltid montert: detaljseksjonene har egne effekter (f.eks. automatisk avslag av Nøkkelhullet). */}
      <div className={open ? "pt-1" : "hidden"}>{p.details}</div>
    </div>
  );
}

interface Props {
  canWrite: boolean;
  saving: boolean;
  onToggleClaim: (field: "label_claim_grain" | "label_claim_keyhole", value: boolean) => void;
  grain: {
    claim: boolean;
    effectivePct: number | null;
    manual: boolean;
    locked: boolean;
    lockedReason: string | null;
    details: ReactNode;
  };
  keyhole: {
    claim: boolean;
    result: KeyholeResult | null;
    locked: boolean;
    lockedReason: string | null;
    details: ReactNode;
  };
  links: RecipeLinkedProduct[];
}

/** «Merker» — Brødskala'n, Nøkkelhullet og 100 % norsk som rader med bryter og status. */
export function LabelMarksCard({ canWrite, saving, onToggleClaim, grain, keyhole, links }: Props) {
  const category = grain.effectivePct != null ? grainCategoryFromPct(grain.effectivePct) : null;
  const k = keyhole.result;
  const keyholeStatus = !k
    ? "Ingen vurdering ennå."
    : k.status === "oppfylt"
      ? `Kriteriene er oppfylt (${k.group_label}).`
      : k.status === "ukjent"
        ? `Kan ikke vurderes ennå${k.status_reason ? `: ${k.status_reason}` : "."}`
        : `Kriteriene er ikke oppfylt${k.status_reason ? `: ${k.status_reason}` : ` for ${k.group_label}.`}`;

  return (
    <Card id="merking-merker" tabIndex={-1} className="scroll-mt-4 outline-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Merker</CardTitle>
        <p className="text-xs text-muted-foreground">Slå på merkene som skal stå på etiketten. Kravene sjekkes mot oppskriften.</p>
      </CardHeader>
      <CardContent>
        <MarkRow
          id="merking-grovhet"
          title="Brødskala'n"
          description="Grovhet beregnes fra andelen sammalt mel og hele korn i oppskriften."
          checked={grain.claim}
          locked={grain.locked}
          lockedReason={grain.lockedReason}
          disabled={!canWrite || saving}
          onToggle={(v) => onToggleClaim("label_claim_grain", v)}
          status={
            grain.effectivePct != null ? (
              <span className="font-medium">
                {grain.manual ? "Manuell" : "Beregnet"} grovhet: {fmtPct(grain.effectivePct)} · {brodskalanFor(category)?.label ?? "—"}
              </span>
            ) : (
              <span className="text-muted-foreground">Grovheten er ikke beregnet.</span>
            )
          }
          details={grain.details}
        >
          <ol aria-label="Grovhetsskala" className="grid grid-cols-2 gap-1 pt-1 sm:grid-cols-4">
            {GRAIN_LEVELS.map((l) => {
              const active = l.key === category;
              return (
                <li
                  key={l.key}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-center text-xs",
                    active ? "border-primary bg-primary font-semibold text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {l.label}
                </li>
              );
            })}
          </ol>
        </MarkRow>

        <MarkRow
          id="merking-nokkelhull"
          title="Nøkkelhullet"
          description="Krav til fett, sukker, salt og fiber for matvaregruppen."
          checked={keyhole.claim}
          locked={keyhole.locked}
          lockedReason={keyhole.lockedReason}
          disabled={!canWrite || saving}
          onToggle={(v) => onToggleClaim("label_claim_keyhole", v)}
          status={<span className={k?.status === "oppfylt" ? "text-success" : "text-muted-foreground"}>{keyholeStatus}</span>}
          mark={<img src={nokkelhulletSrc} alt="" aria-hidden className={cn("h-10 w-10 shrink-0", !keyhole.claim && "opacity-40")} />}
          details={keyhole.details}
        />

        <div id="merking-norsk" className="space-y-2 py-3">
          <div className="text-sm font-medium">100 % norsk (Nyt Norge)</div>
          <p className="text-xs text-muted-foreground">
            Settes per vare under varens merkeordninger, ikke på oppskriften. Status for hver koblet vare:
          </p>
          {links.length === 0 ? (
            <p className="text-xs text-muted-foreground">Ingen koblede varer.</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-md border">
              {links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1">
                  <span className="min-w-0 text-sm">{l.products?.display_name ?? "Uten navn"}</span>
                  <span className="flex items-center gap-2">
                    <span className={cn("text-xs", l.products?.cert_norsk_100 ? "text-success" : "text-muted-foreground")}>
                      {l.products?.cert_norsk_100 == null ? "Ukjent" : l.products.cert_norsk_100 ? "Merket" : "Ikke merket"}
                    </span>
                    <Link
                      to={`/varer/vareliste/${l.product_id}?tab=deklarasjon`}
                      className="inline-flex min-h-11 items-center gap-1 text-xs underline underline-offset-2"
                    >
                      Åpne varen <ExternalLink className="h-3 w-3" aria-hidden />
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

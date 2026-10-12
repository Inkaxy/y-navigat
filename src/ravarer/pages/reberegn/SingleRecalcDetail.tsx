import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { PreviewState, PreviewTarget } from "@/ravarer/hooks/useSingleRecalcPreview";
import { factorSourceLabel, methodLabel, type PreviewChange, type SinglePreview } from "@/ravarer/lib/singleRecalcPreview";

const n6 = (v: number) => v.toLocaleString("nb-NO", { maximumFractionDigits: 6 });
const kr6 = (v: number | null) => (v == null ? "—" : `${n6(v)} kr`);
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${n6(Math.abs(v))} kr`;
const ORIGIN: Record<PreviewTarget["origin"], string> = {
  forslag: "Åpnet fra forslaget. Tallene her er en ny lesing og erstatter ikke forslaget i tabellen.",
  kvittering: "Åpnet fra kvitteringen. Dette er dagens forslag — ikke regnestykket som ble brukt da kjøringen ble utført.",
  feilet: "Åpnet fra en vare som feilet. Dette er dagens forslag, ikke en forklaring på den tidligere feilen.",
};

/** Regnestykket for én linje — bare serverens egne tall, aldri en klientberegning som erstatter dem. */
function Formula({ c, baseUnit }: { c: PreviewChange; baseUnit: string }) {
  const unit = c.unit ?? "";
  if (c.locked) {
    return (
      <p>
        <strong>Ført/låst – beholdes.</strong> Enhetsprisen {kr6(c.oldPpb)} / {baseUnit} beholdes.
        {c.newBaseQty != null && <> Beregnet mengde (ikke anvendt): {n6(c.newBaseQty)} {baseUnit}.</>}
      </p>
    );
  }
  const qty = c.newBaseQty;
  let mengde: ReactNode = null;
  if (c.method === "pakning") {
    mengde = c.quantity != null && c.factor != null && qty != null
      ? <>Mengde: {n6(Math.abs(c.quantity))} × {n6(c.factor)} ≈ {n6(qty)} {baseUnit}</>
      : <>Mengde kunne ikke beregnes.</>;
  } else if (c.method === "direkte") {
    mengde = c.quantity != null && qty != null
      ? <>Serveren konverterer {n6(c.quantity)} {unit} direkte til {n6(qty)} {baseUnit} (omregningstallet returneres ikke).</>
      : <>Mengde kunne ikke beregnes.</>;
  } else {
    mengde = <>{methodLabel(c.method)} — ingen mengde i grunnenhet.</>;
  }
  let pris: ReactNode;
  if (c.newPpb == null) pris = <>Ingen beregnet enhetspris.</>;
  else if (c.totalAmount != null && qty != null && qty !== 0) pris = <>Enhetspris: {n6(Math.abs(c.totalAmount))} kr / {n6(Math.abs(qty))} {baseUnit} ≈ {kr6(c.newPpb)} / {baseUnit}</>;
  else pris = <>Serverens enhetspris: {kr6(c.newPpb)} / {baseUnit} (avrundet mengde er for liten til å vise delingen).</>;
  return <><p>{mengde}</p><p>{pris}</p></>;
}

function appliesText(c: PreviewChange): string {
  if (c.locked) return "Låst — røres ikke";
  if (c.applies === true) return "Tillatt av pakningsgrunnlaget (betyr ikke nødvendigvis endret)";
  if (c.applies === false) return `Bare forhåndsvisning${c.previewReason ? `: ${c.previewReason}` : ""}`;
  return `Grunnlag mangler — bare forhåndsvisning${c.previewReason ? `: ${c.previewReason}` : ""}`;
}

function Body({ p }: { p: SinglePreview }) {
  const diff = p.costBefore != null && p.costAfter != null ? p.costAfter - p.costBefore : null;
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-ink-secondary">Kostpris før</dt><dd className="tabular-nums">{kr6(p.costBefore)}</dd>
        <dt className="text-ink-secondary">Kostpris i serverens regnestykke nå</dt><dd className="tabular-nums">{kr6(p.costAfter)}</dd>
        <dt className="text-ink-secondary">Endring</dt><dd className="tabular-nums">{diff == null ? "—" : signed(diff)}</dd>
      </dl>
      <p className="text-ink-secondary">
        Ved kjøring settes kostprisen av den vanlige regelen (nyeste gyldige pris etter dato), og den kan avvike fra dette tallet.
        Tallene er avrundet av serveren til seks desimaler; ≈ betyr omtrent.
      </p>
      <p>
        Serverens tall: {p.linesTotal} linjer, {p.linesChanged} endres, {p.linesUnknown} uten mengde, {p.linesLocked} låst,
        {" "}{p.linesPreviewOnly} bare forhåndsvisning, {p.linesExcluded} utelatt (ikke vist). Gruppene kan overlappe.
      </p>
      {p.ppbMedian != null && <p className="text-ink-secondary">Median enhetspris {kr6(p.ppbMedian)} / {p.baseUnit} er bare diagnostikk, ikke valgt kostpris.</p>}
      <ul className="space-y-3" aria-label="Fakturalinjer i regnestykket">
        {p.changes.map((c) => (
          <li key={c.lineId} className="rounded-lg border border-line-subtle p-3">
            <p className="font-medium text-ink-primary">{c.description ?? "Uten beskrivelse"}</p>
            <p className="text-caption text-ink-secondary">
              Faktura {c.invoiceNumber ?? "uten nummer"} · {c.invoiceDate ?? "ukjent dato"} · {c.quantity == null ? "—" : n6(c.quantity)} {c.unit ?? ""} · {c.totalAmount == null ? "—" : `${n6(c.totalAmount)} kr`}
            </p>
            <p className="text-caption">Metode: {methodLabel(c.method)} · Faktor: {c.factor == null ? "—" : n6(c.factor)} ({factorSourceLabel(c.factorSource)})</p>
            <p className="text-caption">Lagret enhetspris {kr6(c.oldPpb)} → foreslått {c.locked ? "beholdes" : kr6(c.newPpb)}</p>
            <div className="mt-1 text-caption"><Formula c={c} baseUnit={p.baseUnit} /></div>
            <p className="text-caption text-ink-secondary">{appliesText(c)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

const UNAVAILABLE: Record<"server" | "malformed" | "transport" | "access", string> = {
  server: "Serveren kunne ikke lage regnestykket for denne varen.",
  malformed: "Svaret var ikke fullstendig og vises ikke.",
  transport: "Svaret kom ikke fram. Ingenting er endret — dette var bare en lesing.",
  access: "Krever skrivetilgang til Råvarer og tilgang til fakturaer.",
};

export function SingleRecalcDetail({ state, onClose, onRetry }: { state: PreviewState; onClose: () => void; onRetry: (t: PreviewTarget) => void }) {
  const open = state.status !== "closed";
  const target = state.status === "closed" ? null : state.target;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Serverens regnestykke nå{target?.name ? ` — ${target.name}` : ""}</SheetTitle>
          <SheetDescription>Skrivebeskyttet prøvekjøring for én råvare. Ingenting lagres herfra.</SheetDescription>
        </SheetHeader>
        {target && <p className="mt-3 text-caption text-ink-secondary">{ORIGIN[target.origin]}</p>}
        <div className="mt-4">
          {state.status === "loading" && <p role="status">Henter serverens regnestykke …</p>}
          {state.status === "busy" && (
            <div role="status" className="space-y-2"><p>En annen lesing pågår. Prøv igjen når den er ferdig.</p>
              <Button variant="outline" className="min-h-[44px]" onClick={() => onRetry(state.target)}>Prøv igjen</Button></div>
          )}
          {state.status === "changed" && (
            <div role="alert" className="space-y-2"><p>Dataene er endret siden raden ble hentet. Last inn forslaget på nytt.</p></div>
          )}
          {state.status === "unavailable" && (
            <div role="alert" className="space-y-2"><p>{UNAVAILABLE[state.reason]}</p>
              {state.reason !== "access" && <Button variant="outline" className="min-h-[44px]" onClick={() => onRetry(state.target)}>Prøv igjen</Button>}</div>
          )}
          {state.status === "ok" && <Body p={state.preview} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function DetailButton({ name, onClick, disabled }: { name: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex min-h-[44px] min-w-[44px] items-center text-primary underline-offset-2 hover:underline disabled:opacity-50"
      aria-label={`Se serverens regnestykke for ${name}`}>
      Se serverens regnestykke
    </button>
  );
}

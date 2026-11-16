import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { useSupplierItemLines, useSupplierItems } from "@/fakturaer/hooks/useSupplierItems";
import { osloTodayISO } from "@/lib/osloDate";
import { paths } from "@/ravarer/lib/paths";
import { DECISION_LABEL, DECISION_TONE, decisionQuestion, solvesText, type Decision, type DecisionType } from "@/ravarer/lib/decisions";
import { priceFacts, refineType, type Certainty } from "@/ravarer/lib/decisionFacts";
import { quickAnswersFor, type UndoAnswer } from "@/ravarer/lib/quickAnswers";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { cardFinished, freshStatusFrom } from "@/fakturaer/lib/freshReceipt";
import { lockedOpenLines } from "../priskontroll/gjore/VarekortPanel";
import { QuickAnswers } from "./QuickAnswers";
import type { QuickDone } from "./useQuickAnswers";
import { VarekortPanel } from "../priskontroll/gjore/VarekortPanel";
import { FakturasakPanel } from "../priskontroll/gjore/FakturasakPanel";
import type { PanelResult } from "../priskontroll/gjore/types";
import { PriceFactsView } from "./PriceFactsView";
import { InvoiceExcerpt } from "./InvoiceExcerpt";

export interface DecisionCtx { onDone: (r: PanelResult | null, undo?: UndoAnswer | null) => void; onNext: () => void; onSkip: () => void; retur: string }

const LEAD: Record<DecisionType, string> = {
  pris: "Stemmer denne prisen? Vi har ikke registrert noe varsel om prisendring.",
  over_avtale: "Prisen er høyere enn avtalt. Svaret kan bli et kreditnotaforslag, som går som utkast til Henrik.",
  ukjent_vare: "Velg råvaren den hører til, opprett en ny, eller marker at den ikke er en vare. Svaret gjelder alle linjer med samme vare.",
  pakning: "Rett pakningen her. Du ser ny pris per enhet før du lagrer.",
  sjekk_pakning: "Prisen har hoppet mye. Ofte er det pakningen som er lest eller registrert feil. Rett pakningen her, eller godta prisen.",
  pant: "Pant er en følgevare: den følger varen, holdes utenfor kost og er mva-fri. Den skal aldri utelates.",
  hopp_over: "Paller, miljøvederlag, frakt og gebyr kan hoppes over. Velg «Ikke en vare» under.",
  videresalg: "Varen kjøpes inn for å selges videre. Koble den til varen den selges som, så får den påslag i prislisten.",
  emballasje: "Emballasje går inn i kalkylen til ren kostpris. Legg den inn på varene som pakkes i den.",
  kan_ikke_leses: "Kontroller originalen og rett det som ikke kunne leses.",
  ravare_ikke_klar: "Råvaren brukes i oppskrifter og på etiketter, men allergenene er ikke kontrollert.",
  kontroll: "Bekreft eller endre koblingen. Svaret gjelder alle linjer med samme vare.",
};

const CERT: Record<Certainty, { label: string; tone: string }> = {
  sikkert: { label: "Sikkert", tone: "--state-success" },
  middels: { label: "Middels sikkert", tone: "--state-warning" },
  usikkert: { label: "Usikkert", tone: "--state-danger" },
};

function Header({ d, type, question, children }: { d: Decision; type: DecisionType; question: string; children?: React.ReactNode }) {
  return (
    <header className="space-y-2">
      <p className="flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
        <StatusPill label={DECISION_LABEL[type]} tokenVar={DECISION_TONE[type]} hideDot />
        <span>{solvesText(d)}</span>
      </p>
      <h2 className="font-serif text-title leading-tight">{question}</h2>
      <p className="text-body text-ink-secondary">{LEAD[type]}</p>
      {children}
    </header>
  );
}

function useRecipeCount(rmId: string | null) {
  return useQuery({
    queryKey: ["ravarer", "decision-recipe-count", rmId],
    enabled: !!rmId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("recipe_lines").select("recipe_id").eq("raw_material_id", rmId!).limit(1000);
      if (error) throw error;
      return { n: new Set((data ?? []).map((r) => r.recipe_id)).size, capped: (data ?? []).length >= 1000 };
    },
  });
}

/** Valgt spørsmål: fakta øverst, svaret gis i dagens panel (samme skriveveier som Fakturaer). */
export function DecisionPanel({ d, ctx }: { d: Decision; ctx: DecisionCtx }) {
  if (d.source.kind === "extra") return <ExtraPanel d={d} />;
  const it = d.source.item;
  if (it.type === "faktura" && it.invoice_id) {
    return (
      <div className="space-y-4">
        <Header d={d} type={d.type} question={d.question} />
        <FakturasakPanel key={d.key} invoiceId={it.invoice_id} kind={it.kind} onDone={ctx.onDone} onNext={ctx.onNext} onSkip={ctx.onSkip} />
      </div>
    );
  }
  if (it.supplier_id && it.item_key) return <VarekortDecision d={d} supplierId={it.supplier_id} itemKey={it.item_key} ctx={ctx} />;
  return <p className="text-body text-ink-secondary">Spørsmålet mangler referanse.</p>;
}

function VarekortDecision({ d, supplierId, itemKey, ctx }: { d: Decision; supplierId: string; itemKey: string; ctx: DecisionCtx }) {
  const itemQ = useSupplierItems({ supplierId, itemKey, pageSize: 1 });
  const item = itemQ.data?.items[0] ?? null;
  const { canWrite } = useInvoiceRights();
  const lines = useSupplierItemLines(supplierId, itemKey);
  const facts = useMemo(() => (lines.data ? priceFacts(lines.data, osloTodayISO(), { baseUnit: item?.rm_base_unit ?? null }) : null), [lines.data, item?.rm_base_unit]);
  const type = refineType(d.type, facts);
  const it = d.source.kind === "work" ? d.source.item : null;
  const question = it ? decisionQuestion(type, it, { changePct: facts?.changePct ?? null }) : d.question;
  const rmId = item?.rm_id ?? it?.rm_id ?? null;
  const recipes = useRecipeCount(rmId);
  const cur = facts?.current ?? null;
  const showFacts = facts && (facts.purchases.length > 0 || facts.arithmetic.length > 0);
  const locked = lines.data ? lockedOpenLines(lines.data) != null : false;
  const hasQuick = !!item && !!lines.data && quickAnswersFor(type, { linked: !!item.rm_id && item.status !== "ukoblet", locked }).length > 0;
  const allRef = useRef<HTMLDetailsElement>(null);
  const openAll = () => { if (allRef.current) { allRef.current.open = true; allRef.current.scrollIntoView({ behavior: "smooth", block: "start" }); } };
  // Etter et svar: fersk serverstatus før spørsmålet regnes som besvart (samme regel som varekortet).
  const [after, setAfter] = useState<{ kind: "pending" } | { kind: "rest"; text: string } | null>(null);
  const gen = useRef(0);
  const answered = (q: QuickDone) => {
    const my = ++gen.current;
    setAfter({ kind: "pending" });
    void Promise.all([lines.refetch(), itemQ.refetch()]).then(([lr, qr]) => {
      if (my !== gen.current) return;
      const st = freshStatusFrom({ item: { isError: qr.isError, data: qr.data }, lines: { isError: lr.isError, data: lr.data }, supplierId, itemKey });
      if (cardFinished(st)) { setAfter(null); ctx.onDone(q.result, q.undo); return; }
      setAfter({ kind: "rest", text: st.kind === "ok"
        ? `${q.result.title}. ${st.remaining} ${st.remaining === 1 ? "linje gjenstår" : "linjer gjenstår"} – se «Alle valg».`
        : `${q.result.title}. Status etter lagringen er ukjent; spørsmålet regnes ikke som besvart.` });
    }, () => { if (my === gen.current) setAfter({ kind: "rest", text: `${q.result.title}. Status etter lagringen er ukjent.` }); });
  };
  return (
    <div className="space-y-4">
      <Header d={d} type={type} question={question}>
        {facts?.current && (
          <p className="flex flex-wrap items-center gap-2 text-caption">
            <StatusPill label={CERT[facts.certainty].label} tokenVar={CERT[facts.certainty].tone} hideDot />
            <span className="text-ink-secondary">{facts.certaintyText}</span>
          </p>
        )}
      </Header>
      {lines.isError && <p className="text-caption text-ink-secondary">Kunne ikke hente kjøpene. Svaret under virker fortsatt.</p>}
      {showFacts && <PriceFactsView facts={facts} item={item} />}
      {cur && (
        <InvoiceExcerpt invoiceId={cur.invoice_id} lineId={cur.id} supplierName={item?.supplier_name ?? d.supplierName}
          invoiceNumber={cur.invoice_number} invoiceDate={cur.invoice_date} retur={ctx.retur} />
      )}
      {rmId && (
        <section aria-label="Hva svaret betyr for varene" className="rounded-xl bg-muted/40 p-3 text-body">
          <h3 className="mb-1 text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">Hva svaret betyr for varene</h3>
          <p>
            {recipes.data ? `${item?.rm_name ?? "Råvaren"} brukes i ${recipes.data.n}${recipes.data.capped ? "+" : ""} ${recipes.data.n === 1 ? "oppskrift" : "oppskrifter"}.` : recipes.isError ? "Bruken kunne ikke hentes." : "Henter bruken …"}
            {" "}Brutto og DG2 før og etter per vare kommer med Prisgrunnlag.
          </p>
          <Link className="mt-1 inline-flex min-h-[44px] items-center font-semibold text-primary underline-offset-2 hover:underline sm:min-h-0" to={paths.raavare(rmId, { seksjon: "bruk" })}>Se hvor råvaren brukes</Link>
        </section>
      )}
      {item && lines.data && (
        <QuickAnswers type={type} item={item} lines={lines.data} canWrite={canWrite} locked={locked} onAnswered={answered} onOpenAll={openAll} />
      )}
      {after?.kind === "pending" && <p className="text-caption text-ink-secondary" aria-live="polite">Lagret. Henter faktisk status fra serveren …</p>}
      {after?.kind === "rest" && <p role="status" className="rounded-md border border-line-subtle bg-muted/40 px-3 py-2 text-sm">{after.text}</p>}
      <details ref={allRef} open={!hasQuick} className="rounded-xl border border-line-subtle p-3">
        <summary className="min-h-[44px] cursor-pointer content-center text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">{hasQuick ? "Alle valg" : "Svar"}</summary>
        <div className="mt-2">
          <VarekortPanel key={d.key} supplierId={supplierId} itemKey={itemKey} onDone={(r) => ctx.onDone(r)} onNext={ctx.onNext} onSkip={ctx.onSkip} />
        </div>
      </details>
    </div>
  );
}

function ExtraPanel({ d }: { d: Decision }) {
  if (d.source.kind !== "extra") return null;
  const { rmId } = d.source;
  const target = d.type === "ravare_ikke_klar" ? { seksjon: "deklarasjon" as const, label: "Kontroller allergenene" }
    : d.type === "videresalg" ? { seksjon: "bruk" as const, label: "Koble til varen den selges som" }
    : { seksjon: "bruk" as const, label: "Legg inn på varene som pakkes i den" };
  return (
    <div className="space-y-4">
      <Header d={d} type={d.type} question={d.question} />
      <div className="flex flex-wrap gap-2">
        <Button asChild className="min-h-[44px]"><Link to={paths.raavare(rmId, { seksjon: target.seksjon })}>{target.label}</Link></Button>
        <Button asChild variant="outline" className="min-h-[44px]"><Link to={paths.raavare(rmId)}>Åpne råvarekortet</Link></Button>
      </div>
      <p className="text-caption text-ink-secondary">Spørsmålet forsvinner når råvaren er klar. Det svares i råvarekortet, med dagens lagring.</p>
    </div>
  );
}

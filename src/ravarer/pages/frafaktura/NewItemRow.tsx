import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSupplierSkuIndex } from "@/ravarer/hooks/useSupplierSkuIndex";
import { useSupplierItemLines } from "@/fakturaer/hooks/useSupplierItems";
import { lineLocked } from "@/fakturaer/lib/reviewPlan";
import { isLinkableOpenLine, lockedForLink, NOT_LINKED_APPROVED, NothingSavedError, splitLockedLines } from "@/ravarer/lib/fraFaktura/linkOutcome";
import { useCapability } from "@/lib/pendingRpc";
import { lineMath, unitPrices } from "@/ravarer/lib/fraFaktura/lineMath";
import { dateNo } from "@/ravarer/lib/decisions";
import { paths } from "@/ravarer/lib/paths";
import {
  CREATE_LABEL, canSubmit, cleanItemName, defaultMode, guessItemType, isCreditRow, otherSpellings, packageBadge, packageProposal, packageSourceLine, pricePerBase, readPackage,
  suggestCandidate, type Candidate, type NewItemType, type PackageDraft, type RowAnswer, type RowMode,
} from "@/ravarer/lib/fraFaktura/newItems";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import type { NewItemReceipt, useNewItemActions } from "@/ravarer/hooks/useNewItemActions";
import { RowTarget } from "./RowTarget";
import { RowPackage } from "./RowPackage";
import { InvoiceSnippet } from "./InvoiceSnippet";

export type RowEntry = { answer: RowAnswer | null; submit: () => Promise<boolean> };
type Actions = ReturnType<typeof useNewItemActions>;

/** Én leverandørvare: fakturateksten til venstre, «blir til denne varen» til høyre. Ett svar gjør hele jobben. */
export function NewItemRow({ row, candidates, byId, supplierRule, actions, canWrite, retur, onDone, register }: {
  row: WorkItem & { supplier_id: string; item_key: string };
  candidates: readonly Candidate[]; byId: ReadonlyMap<string, Candidate>; supplierRule: NewItemType | null;
  actions: Actions; canWrite: boolean; retur: string;
  /** `sentAt` = da lagringen ble sendt (for å trekke riktig fra tellere som var på vei). */
  onDone: (key: string, r: NewItemReceipt, sentAt: number) => void;
  register: (key: string, e: RowEntry | null) => void;
}) {
  const lines = useSupplierItemLines(row.supplier_id, row.item_key);
  const all = useMemo(() => lines.data ?? [], [lines.data]);
  // Bare linjer koblingen godtar (åpen, ikke flagget faktura); avstemte/flaggede linjer sendes aldri og gir aldri «0 linjer».
  const open = useMemo(() => all.filter(isLinkableOpenLine), [all]);
  const latest = open[0] ?? all[0] ?? null;
  // Kreditlinjer spør aldri om pakning; pakningsforslaget bygges bare fra en vanlig linje.
  const credit = isCreditRow(open);
  // Linjer på internt godkjente fakturaer eller med ført kostpris kan ikke kobles (serveren hopper over dem).
  // De sendes ikke, og en rad der alle linjene er slik, kan ikke lagres herfra.
  // Godkjente fakturaer kan kobles først når databasen sier det (forslag A); til da er de låst.
  const approvedLinkable = useCapability("rm_cap_kobling_godkjent_v1");
  const { linkable, locked } = useMemo(() => splitLockedLines(open, (l) => lockedForLink(lineLocked(l), approvedLinkable)), [open, approvedLinkable]);
  const lockedApproved = locked.length > 0 && locked.every((l) => lineLocked(l) === "approved");
  // Pris og pakning bygges helst fra en linje som er lest rent; ellers merkes raden «Sjekk tallene».
  const pkgLine = packageSourceLine(open, all, (l) => lineMath(l).clean);
  const math = useMemo(() => (pkgLine ? lineMath(pkgLine) : null), [pkgLine]);
  const text = latest?.description ?? row.title;
  const collision = all.some((l) => (l.review_reason ?? "").includes("sku_collision"));
  // Samme varenummer hos leverandøren sjekkes alltid (ikke bare ved «sku_collision»), så en vare som finnes fra før foreslås først.
  const isSku = row.item_key.startsWith("sku:");
  const skuIndex = useSupplierSkuIndex(row.supplier_id, isSku);
  const sameSku = useMemo((): Candidate[] => {
    if (!isSku || !skuIndex.data) return [];
    return (skuIndex.data.get(row.item_key.slice(4)) ?? []).flatMap((id) => { const c = byId.get(id); return c ? [c] : []; });
  }, [isSku, skuIndex.data, row.item_key, byId]);

  const suggestions = useMemo((): Candidate[] => {
    if (row.kind === "mangler_pakning" && row.rm_id) { const c = byId.get(row.rm_id); return c ? [c] : []; }
    const s = suggestCandidate(text, candidates);
    return sameSku.length ? [...sameSku, ...(s && !sameSku.some((c) => c.id === s.id) ? [s] : [])] : s ? [s] : [];
  }, [row.kind, row.rm_id, byId, sameSku, text, candidates]);
  const suggestionLabel = row.kind === "mangler_pakning" ? "Koblet i dag" : sameSku.length || collision ? "Samme varenummer" : "Forslag";

  const [mode, setMode] = useState<RowMode>("opprett");
  const [pick, setPick] = useState<Candidate | null>(null);
  const [name, setName] = useState(cleanItemName(row.title));
  const [type, setType] = useState<NewItemType>(guessItemType(row.title, supplierRule));
  const [draft, setDraft] = useState<PackageDraft>(packageProposal(null));
  const [snippet, setSnippet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  // «Prøv igjen» gjentar siste svar. Ingenting er lagret når feilen vises (0 linjer eller avvist), og en gjentatt
  // kobling av linjer som alt er koblet endrer ingenting.
  const [retry, setRetry] = useState<(() => void) | null>(null);
  // «Ingenting ble lagret»: teksten avgjøres når linjene er hentet på nytt (godkjent faktura eller annen grunn).
  const [nothingSaved, setNothingSaved] = useState(false);
  const init = useRef({ lines: false, sug: false });

  useEffect(() => {
    if (!latest || init.current.lines) return;
    init.current.lines = true;
    setName(cleanItemName(latest.description ?? row.title));
    setType(guessItemType(latest.description ?? row.title, supplierRule));
    setDraft(packageProposal(pkgLine, null, math));
  }, [latest, pkgLine, math, row.title, supplierRule]);
  useEffect(() => {
    if (init.current.sug || lines.isLoading || (isSku && skuIndex.isLoading)) return;
    init.current.sug = true;
    setMode(defaultMode(suggestions.length > 0));
    setPick(suggestions[0] ?? null);
  }, [suggestions, lines.isLoading, isSku, skuIndex.isLoading]);

  const baseUnit = mode === "koble" ? pick?.base_unit ?? null : null;
  const state = readPackage(draft, baseUnit);
  const badge = packageBadge({ text, draft, state, mode, hasSuggestion: suggestions.length > 0 && !!pick && suggestions.some((s) => s.id === pick.id), numbersOk: math?.clean !== false });
  const price = pricePerBase(pkgLine, state, math ? math.units : undefined);
  const perUnit = pkgLine ? unitPrices(pkgLine, math) : [];
  // «Opprett som ny» når samme varenummer alt finnes: aldri med i «Opprett N sikre».
  const answer: RowAnswer = { mode, type, name, pick, badge, state, existingMatch: sameSku.length > 0 };
  const lineIds = linkable.map((l) => l.id);
  const ready = !lines.isLoading && !lines.isError && lineIds.length > 0;
  const allLocked = !lines.isLoading && open.length > 0 && linkable.length === 0 && locked.length > 0;
  // Kreditnota-raden svarer aldri «Opprett N sikre» (ingen pakning å godkjenne).
  const answerable = ready && !credit;

  const submit = async (): Promise<boolean> => {
    if (lock.current || !canWrite || !answerable || !canSubmit(answer)) return false;
    lock.current = true; setBusy(true); setError(null); setRetry(null); setNothingSaved(false);
    const sentAt = Date.now();
    try {
      const r = await actions.link({
        supplierId: row.supplier_id, supplierName: row.supplier_name, itemKey: row.item_key, text: text ?? row.title, lineIds,
        target: mode === "koble" && pick ? { kind: "existing", id: pick.id, name: pick.name } : { kind: "new", name, type }, pkg: state,
      });
      onDone(row.key, r, sentAt);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke lagre. Utfallet er ukjent – last siden på nytt før du prøver igjen.");
      setNothingSaved(e instanceof NothingSavedError);
      setRetry(() => () => void submitRef.current());
      return false;
    } finally { lock.current = false; setBusy(false); }
  };
  const notItem = async () => {
    if (lock.current || !canWrite || !ready) return;
    lock.current = true; setBusy(true); setError(null); setRetry(null); setNothingSaved(false);
    const sentAt = Date.now();
    try { onDone(row.key, await actions.notItem({ supplierId: row.supplier_id, supplierName: row.supplier_name, itemKey: row.item_key, text: text ?? row.title, lineIds }), sentAt); }
    catch (e) { setError(e instanceof Error ? e.message : "Kunne ikke lagre."); setNothingSaved(e instanceof NothingSavedError); setRetry(() => () => void notItemRef.current()); }
    finally { lock.current = false; setBusy(false); }
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const notItemRef = useRef(notItem);
  notItemRef.current = notItem;
  const answerKey = `${mode}|${type}|${name}|${pick?.id ?? ""}|${badge}|${state.state}|${answerable}|${sameSku.length}`;
  useEffect(() => {
    register(row.key, { answer: answerable ? answer : null, submit: () => submitRef.current() });
    return () => register(row.key, null);
  }, [answerKey]); // eslint-disable-line react-hooks/exhaustive-deps -- registrerer bare når svaret endres

  const spellings = otherSpellings(text, all.map((l) => l.description));
  const disabled = !canWrite || busy;
  const primary = mode === "koble" ? (pick ? "Koble" : "Velg en vare") : CREATE_LABEL[type];
  const atInvoice = (handling: "kreditnota" | "hold-linje" | "hold-faktura") =>
    latest ? paths.faktura(latest.invoice_id, { linje: latest.id, handling, retur }) : null;
  const holdHref = atInvoice(credit ? "hold-faktura" : "hold-linje");
  const creditHref = atInvoice("kreditnota");

  return (
    <li className="border-t border-line-subtle px-4 py-4 md:px-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1.6fr)_12rem] lg:items-center xl:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1.6fr)_15rem]">
        <div className="min-w-0 space-y-0.5">
          <p className="text-body font-semibold">{text}</p>
          <p className="text-caption text-ink-secondary">{row.supplier_name ?? "Ukjent leverandør"} · {row.sku ? `varenr ${row.sku}` : "uten varenummer"}</p>
          {allLocked && lockedApproved && <p className="inline-flex rounded-md bg-warning/15 px-2 py-0.5 text-caption font-semibold text-warning">Ligger på godkjent faktura</p>}
          <p className="text-caption text-ink-secondary">På {row.invoice_count} {row.invoice_count === 1 ? "faktura" : "fakturaer"} · sist {dateNo(row.last_date)}</p>
          {spellings.length > 0 && <p className="text-caption text-ink-secondary">Også skrevet: {spellings.map((s) => `«${s}»`).join(", ")}</p>}
          {latest && (
            <button type="button" className="min-h-[32px] text-caption font-semibold text-primary hover:underline" aria-expanded={snippet} onClick={() => setSnippet((v) => !v)}>
              {snippet ? "Skjul fakturaen" : "Vis på fakturaen"}
            </button>
          )}
        </div>
        <ArrowRight className="hidden h-5 w-5 text-primary lg:block" aria-hidden />
        <div className="min-w-0 space-y-2">
          {lines.isLoading ? <p className="text-caption text-ink-secondary">Henter linjene …</p>
            : lines.isError ? <p role="alert" className="text-caption text-destructive">Kunne ikke hente linjene for varen. Last siden på nytt.</p>
            : credit ? (
              <div className="space-y-1 rounded-xl border border-line-subtle bg-muted/30 px-3 py-2 text-sm">
                <p className="font-semibold">Kreditnota – koble til opprinnelig faktura</p>
                <p className="text-caption text-ink-secondary">Kreditlinjer trenger ingen pakning. Koble kreditnotaen til fakturaen den gjelder, eller hold den utenfor råvarebehandling.</p>
              </div>
            ) : (
              <>
                <RowTarget mode={mode} onMode={setMode} pick={pick} onPick={setPick} suggestions={suggestions} suggestionLabel={suggestionLabel}
                  candidates={candidates} name={name} onName={setName} type={type} onType={setType} disabled={disabled} />
                {mode === "opprett" && sameSku.length > 0 && (
                  <p role="note" className="text-caption font-semibold text-warning">
                    Finnes kanskje fra før: {sameSku.map((c) => `«${c.name}»${c.base_unit ? ` (${c.base_unit})` : ""}`).join(", ")} har samme varenummer hos leverandøren. Koble heller til den, eller slå sammen i Varer etterpå.
                  </p>
                )}
                {skuIndex.isError && <p role="alert" className="text-caption text-destructive">Kunne ikke sjekke om varenummeret finnes fra før. Forslaget bygger bare på navnet.</p>}
                <RowPackage draft={draft} onDraft={setDraft} state={state} badge={badge} price={price} baseUnit={baseUnit} disabled={disabled}
                  unitPrices={perUnit} numbersNote={math && !math.clean ? math.note : null} />
                {allLocked ? (
                  <p role="note" className="text-caption font-semibold text-warning">
                    {lockedApproved
                      ? `${locked.length === 1 ? "Linjen står på en faktura" : `Alle ${locked.length} linjene står på fakturaer`} som er godkjent internt. De kan ikke kobles herfra før godkjenningen er opphevet på fakturaen.`
                      : `${locked.length === 1 ? "Linjen er" : `Alle ${locked.length} linjene er`} låst (godkjent internt eller ført kostpris) og kan ikke kobles herfra.`}
                  </p>
                ) : locked.length > 0 && (
                  <p role="note" className="text-caption text-ink-secondary">{locked.length} av {open.length} linjer er låst (godkjent internt eller ført kostpris) og kobles ikke nå.</p>
                )}
              </>
            )}
        </div>
        {/* Handlingene bryter til ny linje i stedet for å gå utenfor kanten (smal kolonne ved ca. 1024–1280 px). */}
        <div className="flex min-w-0 flex-col gap-2">
          {credit ? (
            creditHref && canWrite
              ? <Button asChild className="min-h-[44px]"><Link to={creditHref}>Koble til opprinnelig faktura</Link></Button>
              : <Button className="min-h-[44px]" disabled>Koble til opprinnelig faktura</Button>
          ) : (
            <Button className="min-h-[44px]" disabled={disabled || !answerable || !canSubmit(answer)} onClick={() => void submit()}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{primary}
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-[44px] min-w-[5.5rem] flex-1" disabled={disabled || !ready} onClick={() => void notItem()}>Ikke vare</Button>
            {holdHref && canWrite
              ? <Button asChild variant="outline" className="min-h-[44px] min-w-[7.5rem] flex-1"><Link to={holdHref} title={credit ? "Hold hele kreditnotaen utenfor råvarebehandling" : "Hold den nyeste linjen (eller hele fakturaen) utenfor råvarebehandling"}>Hold utenfor …</Link></Button>
              : <Button variant="outline" className="min-h-[44px] min-w-[7.5rem] flex-1" disabled>Hold utenfor …</Button>}
          </div>
        </div>
      </div>
      {error && (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 flex-1">{nothingSaved && allLocked && lockedApproved ? NOT_LINKED_APPROVED : error}</span>
          {retry && !allLocked && <Button variant="outline" className="min-h-[44px]" disabled={busy} onClick={retry}>Prøv igjen</Button>}
        </div>
      )}
      {snippet && latest && (
        <div className="mt-3">
          <InvoiceSnippet invoiceId={latest.invoice_id} invoiceNumber={latest.invoice_number} invoiceDate={latest.invoice_date}
            supplierName={row.supplier_name} lineId={latest.id} retur={retur} onClose={() => setSnippet(false)} />
        </div>
      )}
    </li>
  );
}

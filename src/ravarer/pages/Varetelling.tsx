import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, ClipboardCheck, Loader2, Search } from "lucide-react";

import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useAllStockStatus, type AllStockRow } from "@/ravarer/hooks/useAllStockStatus";
import { useRawMaterialUnitsFor, type RawMaterialUnitRow } from "@/ravarer/hooks/useRawMaterialUnits";
import { buildCountPayload } from "@/ravarer/hooks/useStockCount";
import { BASE_KEY, UnitAmountRows, emptyRow, rowsToBase, type UnitAmountRow } from "@/ravarer/components/stock/UnitAmountRows";
import { formatNok, formatNumber } from "@/ravarer/lib/constants";
import { QueryState } from "@/components/common/QueryState";
import { osloTodayISO } from "@/lib/osloDate";
import {
  clearCountDraft,
  countDraftKey,
  loadCountDraft,
  loadLocations,
  missingBaseline,
  newOpId,
  saveCountDraft,
  shouldAutosave,
  saveLocation,
  type CountDraft,
} from "@/ravarer/lib/countDraft";
import { discardCountSheet, fetchOpenCountSheetResult, saveCountSheet, type CountSheetPayload } from "@/ravarer/lib/countSheets";
import type { CountResult } from "@/ravarer/lib/countSubmission";
import { useCountSubmission } from "./varetelling/useCountSubmission";
import { CountResultDialog, CountSubmissionBanner, DraftSaveStatus, type ServerSaveState } from "./varetelling/CountPanels";

export default function Varetelling() {
  const { canWrite, legalEntityId, user } = useRavarer();
  const draftKey = countDraftKey(legalEntityId, osloTodayISO());
  const stockQuery = useAllStockStatus();
  const rows = useMemo(() => stockQuery.data ?? [], [stockQuery.data]);
  const unitsQuery = useRawMaterialUnitsFor(rows.map(r => r.raw_material_id));
  const loadError = stockQuery.error ?? unitsQuery.error;
  const isLoading = stockQuery.isLoading || unitsQuery.isLoading;
  const retryAll = () => {
    void stockQuery.refetch();
    void unitsQuery.refetch();
  };
  const submission = useCountSubmission(legalEntityId, canWrite);
  const locked = submission.locked;

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [itemType, setItemType] = useState("all");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<Record<string, UnitAmountRow[]>>({});
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<Record<string, string>>({});
  // Forventet beholdning fryses ved første endring på linja og følger utkastet (lokalt og server).
  const [frozen, setFrozen] = useState<Record<string, number>>({});
  const [result, setResult] = useState<CountResult | null>(null);
  const [pendingDraft, setPendingDraft] = useState<CountDraft | null>(null);
  const [draftSource, setDraftSource] = useState<"lokalt" | "server">("lokalt");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmZero, setConfirmZero] = useState(false);
  const [serverSave, setServerSave] = useState<ServerSaveState>("idle");
  const [opId, setOpId] = useState<string>(() => submission.pending?.opId ?? newOpId());
  // Generasjon for serverlagring: sene svar etter bokføring/forkasting ignoreres.
  const saveGen = useRef(0);
  const [localSaveFailed, setLocalSaveFailed] = useState(false);
  const [serverDraftLoad, setServerDraftLoad] = useState<"loading" | "done" | "error">("loading");
  const [serverDraftReload, setServerDraftReload] = useState(0);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    let cancelled = false;
    const local = loadCountDraft(draftKey);
    if (local) {
      setPendingDraft(local);
      setDraftSource("lokalt");
    }
    setDraftLoaded(true);
    if (!legalEntityId) return () => { cancelled = true; };
    setServerDraftLoad("loading");
    void fetchOpenCountSheetResult(legalEntityId, osloTodayISO()).then(res => {
      if (cancelled) return;
      if (res.kind === "error") { setServerDraftLoad("error"); return; }
      setServerDraftLoad("done");
      if (res.kind !== "draft") return;
      const sheet = res.row;
      // Et pågående redigert utkast erstattes aldri stille av et serverutkast.
      if (dirtyRef.current) return;
      const serverNewer = !local || (sheet.updated_at && sheet.updated_at > local.savedAt);
      if (!serverNewer) return;
      setPendingDraft({
        entries: sheet.payload.entries,
        lineNotes: sheet.payload.lineNotes,
        note: sheet.payload.note,
        opId: sheet.op_id,
        savedAt: sheet.updated_at,
        expected: sheet.payload.expected,
        legacyBaseline: false,
      });
      setDraftSource("server");
    });
    return () => {
      cancelled = true;
    };
  }, [draftKey, legalEntityId, serverDraftReload]);

  useEffect(() => {
    if (locked || !canWrite || !shouldAutosave(draftLoaded, dirty)) return;
    setLocalSaveFailed(!saveCountDraft(draftKey, { entries, lineNotes, note, opId, expected: frozen }));
  }, [draftKey, draftLoaded, dirty, entries, lineNotes, note, opId, frozen, locked, canWrite]);

  // Serverlagring er sekundær; den stanses mens en innsending er uavklart og uten skrivetilgang.
  // Tilgangstap avbryter en planlagt (ikke sendt) lagring via effektens opprydding.
  useEffect(() => {
    if (locked || !canWrite || !draftLoaded || !legalEntityId || !user?.id || !dirty) return;
    if (Object.keys(entries).length === 0) return;
    const payload: CountSheetPayload = { entries, lineNotes, expected: frozen, note };
    const gen = ++saveGen.current;
    const t = setTimeout(() => {
      setServerSave("saving");
      void saveCountSheet({ legalEntityId, dateISO: osloTodayISO(), opId, payload, createdBy: user.id }).then(ok => {
        if (gen !== saveGen.current) return;
        setServerSave(ok ? "saved" : "failed");
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [locked, canWrite, draftLoaded, legalEntityId, user?.id, dirty, entries, lineNotes, frozen, note, opId]);

  const categories = useMemo(
    () => Array.from(new Set(rows.map(r => r.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b, "nb")),
    [rows],
  );
  const itemTypes = useMemo(() => Array.from(new Set(rows.map(r => r.item_type).filter(Boolean))).sort(), [rows]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      r =>
        (!needle || `${r.name} ${r.sku}`.toLowerCase().includes(needle)) &&
        (category === "all" || r.category === category) &&
        (itemType === "all" || r.item_type === itemType),
    );
  }, [rows, q, category, itemType]);

  useEffect(() => {
    setLocations(loadLocations(legalEntityId));
  }, [legalEntityId]);

  const setLocationFor = (id: string, value: string) => {
    setLocations(prev => ({ ...prev, [id]: value }));
    saveLocation(legalEntityId, id, value);
  };
  const unitsFor = (id: string): RawMaterialUnitRow[] => unitsQuery.data?.get(id) ?? [];
  const expectedFor = (r: AllStockRow) => frozen[r.raw_material_id] ?? r.current_stock;
  const freeze = (r: AllStockRow) =>
    setFrozen(prev => (r.raw_material_id in prev ? prev : { ...prev, [r.raw_material_id]: r.current_stock }));
  const rowsFor = (id: string) => entries[id] ?? [emptyRow()];
  const countedBase = (r: AllStockRow) => rowsToBase(rowsFor(r.raw_material_id), unitsFor(r.raw_material_id));

  const filled = useMemo(
    () => rows.filter(r => countedBase(r) != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, entries, unitsQuery.data],
  );
  const needsBaseline = useMemo(() => new Set(missingBaseline({ entries, expected: frozen })), [entries, frozen]);
  const nameOf = (id: string) => rows.find(r => r.raw_material_id === id)?.name ?? "Ukjent vare";

  const diffValue = filled.reduce((sum, r) => {
    const counted = countedBase(r);
    if (counted == null) return sum;
    return sum + (counted - expectedFor(r)) * (r.current_cost_price ?? 0);
  }, 0);

  const hasDraft = Object.keys(entries).length > 0;
  useEffect(() => {
    if (!hasDraft && !locked) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasDraft, locked]);

  const resetAfterApplied = () => {
    saveGen.current++;
    setEntries({});
    setLineNotes({});
    setFrozen({});
    setNote("");
    setOpId(newOpId());
    setDirty(false);
    setServerSave("idle");
    clearCountDraft(draftKey);
  };

  const submit = async () => {
    if (locked || !canWrite || !legalEntityId || needsBaseline.size > 0) return;
    const inputs = filled
      .map(r => ({
        raw_material_id: r.raw_material_id,
        counted_base: countedBase(r) as number,
        expected_base: frozen[r.raw_material_id],
        line_note: (lineNotes[r.raw_material_id] ?? "").trim() || null,
        location: (locations[r.raw_material_id] ?? "").trim() || null,
      }))
      .filter(l => Number.isFinite(l.counted_base) && Number.isFinite(l.expected_base));
    if (inputs.length !== filled.length || inputs.length === 0) return;
    const details = filled
      .map(r => {
        const n = (lineNotes[r.raw_material_id] ?? "").trim();
        return n ? `${r.name}: ${n}` : null;
      })
      .filter((x): x is string => !!x);
    const fullNote = [note.trim() || "Varetelling", ...details].join(" | ");
    saveGen.current++;
    const res = await submission.send({
      legalEntityId,
      opId,
      lines: buildCountPayload(inputs),
      note: fullNote,
      sentAt: new Date().toISOString(),
    });
    if (res) {
      setResult(res);
      resetAfterApplied();
    }
  };

  const retrySubmission = async () => {
    const res = await submission.retry();
    if (res) {
      setResult(res);
      resetAfterApplied();
    }
  };

  const releaseSubmission = () => {
    const kind = submission.state.kind === "rejected" ? submission.state.error.kind : null;
    if (!canWrite || !submission.release()) return;
    // Bare bevist innholdskonflikt krever ny ID; den byttes som følge av brukerens eksplisitte valg.
    if (kind === "content") setOpId(newOpId());
  };

  const setRestToZero = () => {
    setDirty(true);
    setEntries(prev => {
      const next = { ...prev };
      for (const r of visible) {
        const hasValue = (prev[r.raw_material_id] ?? []).some(row => row.amount.trim() !== "");
        if (!hasValue) {
          next[r.raw_material_id] = [{ amount: "0", unitKey: BASE_KEY }];
          freeze(r);
        }
      }
      return next;
    });
  };
  const restCount = visible.filter(r => !(entries[r.raw_material_id] ?? []).some(row => row.amount.trim() !== "")).length;

  const countUnitText = (r: AllStockRow) => {
    const units = unitsFor(r.raw_material_id);
    const preferred = units.find(u => u.is_default_count) ?? units.find(u => u.is_default_purchase);
    if (!preferred || !Number(preferred.units_in_base)) return null;
    return `${formatNumber(r.current_stock / Number(preferred.units_in_base), 2)} ${preferred.unit_label}`;
  };

  return (
    <div className="space-y-5 pb-4">
      <RavarerHeaderBanner />

      <CountSubmissionBanner
        pending={submission.pending}
        state={submission.state}
        onRetry={() => void retrySubmission()}
        onRelease={releaseSubmission}
        onReconcile={() => void submission.reconcile()}
        canWrite={canWrite}
        stockRefreshFailed={stockQuery.isError}
        stockRefreshing={stockQuery.isFetching}
      />

      {serverDraftLoad === "error" && (
        <Card role="alert" className="flex flex-wrap items-center justify-between gap-3 border-warning/50 p-4 text-sm">
          <span>Kunne ikke sjekke om det finnes et lagret utkast på serveren. Lokalt utkast er beholdt.</span>
          <Button variant="outline" className="min-h-[44px]" onClick={() => setServerDraftReload(n => n + 1)}>Prøv igjen</Button>
        </Card>
      )}

      {pendingDraft && !locked && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warning/50 p-4">
          <p className="text-sm">
            Du har en påbegynt telling fra i dag som ikke ble bokført{draftSource === "server" ? " (lagret på serveren)" : " (lagret på denne enheten)"}.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="min-h-[44px]"
              disabled={!canWrite}
              onClick={() => {
                if (!canWrite) return;
                setDirty(false);
                clearCountDraft(draftKey);
                if (draftSource === "server") void discardCountSheet(pendingDraft.opId);
                setPendingDraft(null);
              }}
            >
              Forkast
            </Button>
            <Button
              className="min-h-[44px]"
              disabled={!canWrite}
              onClick={() => {
                if (!canWrite) return;
                setDirty(true);
                setEntries(pendingDraft.entries);
                setLineNotes(pendingDraft.lineNotes);
                setNote(pendingDraft.note);
                // Det opprinnelige utgangspunktet følger med; mangler det, må det gjennomgås eksplisitt.
                setFrozen(pendingDraft.expected);
                setOpId(pendingDraft.opId);
                setPendingDraft(null);
              }}
            >
              Fortsett tellingen
            </Button>
          </div>
        </Card>
      )}

      {needsBaseline.size > 0 && !locked && (
        <Card role="alert" className="space-y-3 border-warning/60 p-4">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <div>
              <p className="font-medium">Utkastet mangler opprinnelig beholdning for {needsBaseline.size} varer</p>
              <p className="text-ink-secondary">
                Utkastet er lagret med en eldre versjon. Hvis beholdningen er endret siden du talte, vil det ikke bli oppdaget. Kontroller
                tallene mot dagens beholdning før du bruker den som utgangspunkt: {Array.from(needsBaseline).map(nameOf).join(", ")}.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={() => {
              setDirty(true);
              setFrozen(prev => {
                const next = { ...prev };
                for (const id of needsBaseline) {
                  const r = rows.find(x => x.raw_material_id === id);
                  if (r) next[id] = r.current_stock;
                }
                return next;
              });
            }}
          >
            Jeg har kontrollert — bruk dagens beholdning
          </Button>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Varer i tellelisten</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{visible.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Talt opp</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{filled.length}</p>
        </Card>
        <Card className={`p-4 ${diffValue < 0 ? "border-destructive/50" : ""}`}>
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Differanse i kroner</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${diffValue < 0 ? "text-destructive" : diffValue > 0 ? "text-success" : ""}`}>
            {formatNok(diffValue)}
          </p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" aria-hidden />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Søk navn eller SKU…" aria-label="Søk i tellelisten" className="h-[44px] pl-9" />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-[44px] w-full sm:w-[200px]" aria-label="Kategori"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle kategorier</SelectItem>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={itemType} onValueChange={setItemType}>
            <SelectTrigger className="h-[44px] w-full sm:w-[180px]" aria-label="Varetype"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle varetyper</SelectItem>
              {itemTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {isLoading || loadError || visible.length === 0 ? (
        <Card className="p-6">
          <QueryState
            scope="ravarer:varetelling"
            isLoading={isLoading}
            isError={!!loadError}
            error={loadError}
            isEmpty={visible.length === 0}
            onRetry={retryAll}
            emptyTitle="Ingen lagerførte varer i utvalget."
          />
        </Card>
      ) : (
        <fieldset disabled={locked || !canWrite} aria-label="Telleliste" className="space-y-3 disabled:opacity-70">
          {visible.map(r => {
            const counted = countedBase(r);
            const diff = counted == null ? null : counted - expectedFor(r);
            const base = frozen[r.raw_material_id];
            const drifted = base != null && base !== r.current_stock;
            return (
              <Card key={r.raw_material_id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 sm:min-w-[200px]">
                    <p className="break-words font-medium">{r.name}</p>
                    <p className="text-xs text-ink-secondary">
                      Bokført: {formatNumber(r.current_stock, 2)} {r.base_unit}
                      {countUnitText(r) && <> · {countUnitText(r)}</>}
                    </p>
                    {drifted && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-warning">
                        <span>
                          Talt mot {formatNumber(base, 2)} {r.base_unit} — beholdningen er nå {formatNumber(r.current_stock, 2)}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-[44px] sm:min-h-0"
                          onClick={() => {
                            setDirty(true);
                            setFrozen(prev => ({ ...prev, [r.raw_material_id]: r.current_stock }));
                          }}
                        >
                          Bruk ny beholdning
                        </Button>
                      </div>
                    )}
                    <Input
                      value={locations[r.raw_material_id] ?? ""}
                      onChange={e => setLocationFor(r.raw_material_id, e.target.value)}
                      placeholder="Lokasjon"
                      aria-label={`Lokasjon for ${r.name}`}
                      className="mt-2 h-[44px] text-sm sm:h-9"
                    />
                    <Input
                      value={lineNotes[r.raw_material_id] ?? ""}
                      onChange={e => {
                        setDirty(true);
                        setLineNotes(prev => ({ ...prev, [r.raw_material_id]: e.target.value }));
                      }}
                      placeholder="Notat"
                      aria-label={`Notat for ${r.name}`}
                      className="mt-2 h-[44px] text-sm sm:h-9"
                    />
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <UnitAmountRows
                      rows={rowsFor(r.raw_material_id)}
                      onChange={next => {
                        setDirty(true);
                        freeze(r);
                        setEntries(prev => ({ ...prev, [r.raw_material_id]: next }));
                      }}
                      units={unitsFor(r.raw_material_id)}
                      baseUnit={r.base_unit}
                      compact
                    />
                    {diff != null && (
                      <Badge
                        variant="outline"
                        className={diff < 0 ? "border-destructive/50 text-destructive" : diff > 0 ? "border-success/50 text-success" : ""}
                      >
                        {diff > 0 ? "+" : ""}
                        {formatNumber(diff, 2)} {r.base_unit}
                        {r.current_cost_price != null && <> · {formatNok(diff * r.current_cost_price)}</>}
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </fieldset>
      )}

      <Card className="sticky bottom-0 z-10 space-y-3 p-4 shadow-lg sm:bottom-4">
        <fieldset disabled={locked || !canWrite}>
          <Label className="text-xs" htmlFor="count-note">Notat på tellingen</Label>
          <Textarea id="count-note" value={note} onChange={e => { setDirty(true); setNote(e.target.value); }} rows={2} placeholder="F.eks. «Månedstelling tørrvarelager»" />
        </fieldset>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm text-ink-secondary">{filled.length} varer talt opp. Varer uten tall hoppes over.</p>
            <DraftSaveStatus hasDraft={hasDraft && dirty} server={serverSave} localFailed={localSaveFailed} />
          </div>
          <Button variant="outline" className="min-h-[44px] w-full sm:w-auto" onClick={() => setConfirmZero(true)} disabled={!canWrite || locked || restCount === 0}>
            Sett resten til 0
          </Button>
          <Button
            className="min-h-[44px] w-full sm:w-auto"
            size="lg"
            disabled={!canWrite || locked || filled.length === 0 || needsBaseline.size > 0}
            onClick={() => void submit()}
          >
            {submission.isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden />}
            Bokfør telling
          </Button>
        </div>
      </Card>

      <AlertDialog open={confirmZero} onOpenChange={setConfirmZero}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sett {restCount} varer til 0?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle synlige varer uten tall i dette utvalget får talt beholdning 0. Ved bokføring blir de ført ned til null. Varer som er skjult
              av søk eller filter berøres ikke.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Avbryt</AlertDialogCancel>
            <AlertDialogAction className="min-h-[44px]" disabled={!canWrite || locked} onClick={() => { if (canWrite && !locked) setRestToZero(); }}>Sett til 0</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CountResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}

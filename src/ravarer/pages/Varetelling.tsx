import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClipboardCheck, Loader2, Search } from "lucide-react";

import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useAllStockStatus, type AllStockRow } from "@/ravarer/hooks/useAllStockStatus";
import { useRawMaterialUnitsFor, type RawMaterialUnitRow } from "@/ravarer/hooks/useRawMaterialUnits";
import { useApplyRmStockCount, type CountResult } from "@/ravarer/hooks/useStockCount";
import { BASE_KEY, UnitAmountRows, emptyRow, rowsToBase, type UnitAmountRow } from "@/ravarer/components/stock/UnitAmountRows";
import { formatNok, formatNumber } from "@/ravarer/lib/constants";
import { QueryState } from "@/components/common/QueryState";
import { osloTodayISO } from "@/lib/osloDate";
import {
  clearCountDraft,
  countDraftKey,
  loadCountDraft,
  loadLocations,
  newOpId,
  saveCountDraft,
  shouldAutosave,
  saveLocation,
  type CountDraft,
} from "@/ravarer/lib/countDraft";
import {
  discardCountSheet,
  fetchOpenCountSheet,
  saveCountSheet,
  type CountSheetPayload,
} from "@/ravarer/lib/countSheets";


export default function Varetelling() {
  const { canWrite, legalEntityId, user } = useRavarer();
  const draftKey = countDraftKey(legalEntityId, osloTodayISO());
  const stockQuery = useAllStockStatus();
  const rows = useMemo(() => stockQuery.data ?? [], [stockQuery.data]);
  const unitsQuery = useRawMaterialUnitsFor(rows.map(r => r.raw_material_id));
  // Feil fra begge kildene samles ett sted, med felles «Prøv igjen».
  const loadError = stockQuery.error ?? unitsQuery.error;
  const isLoading = stockQuery.isLoading || unitsQuery.isLoading;
  const retryAll = () => {
    void stockQuery.refetch();
    void unitsQuery.refetch();
  };
  const apply = useApplyRmStockCount();

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [itemType, setItemType] = useState("all");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<Record<string, UnitAmountRow[]>>({});
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  // Lokasjon er egen, varig informasjon om varen — ikke en del av telleutkastet,
  // og huskes derfor per selskap på tvers av datoer, ikke per telling.
  const [locations, setLocations] = useState<Record<string, string>>({});
  // Forventet beholdning fryses ved første endring på linja. Uten dette ville
  // et bakgrunnsoppdatert tall gjøre konfliktkontrollen verdiløs: serveren ville
  // sammenlignet mot beholdningen i det øyeblikket brukeren trykket «Bokfør».
  const [frozen, setFrozen] = useState<Record<string, number>>({});
  const [result, setResult] = useState<CountResult | null>(null);
  // Et lagret utkast tas aldri i bruk uten at brukeren sier ja — ellers dukker
  // gamle tall opp midt i en ny telling.
  const [pendingDraft, setPendingDraft] = useState<CountDraft | null>(null);
  const [pendingExpected, setPendingExpected] = useState<Record<string, number>>({});
  const [draftSource, setDraftSource] = useState<"lokalt" | "server">("lokalt");
  const [draftLoaded, setDraftLoaded] = useState(false);
  // Autosave skal aldri kjøre før brukeren faktisk har gjort noe med tellingen —
  // ellers sletter den tomme førstegangs-lagringen et allerede lagret utkast.
  const [dirty, setDirty] = useState(false);
  // Operasjons-ID: følger tellingen til den er bokført, slik at et nytt forsøk
  // etter nettbrudd eller dobbeltklikk aldri fører tellingen to ganger.
  const [opId, setOpId] = useState<string>(() => newOpId());

  // Utkast hentes både lokalt og fra serveren; serverutkastet vinner når det er nyere,
  // slik at en telling kan fortsette på et annet nettbrett.
  useEffect(() => {
    let cancelled = false;
    const local = loadCountDraft(draftKey);
    if (local) {
      setPendingDraft(local);
      setDraftSource("lokalt");
    }
    setDraftLoaded(true);
    if (!legalEntityId) return () => { cancelled = true; };
    void fetchOpenCountSheet(legalEntityId, osloTodayISO()).then(sheet => {
      if (cancelled || !sheet) return;
      const serverNewer = !local || (sheet.updated_at && sheet.updated_at > local.savedAt);
      if (!serverNewer) return;
      setPendingDraft({
        entries: sheet.payload.entries,
        lineNotes: sheet.payload.lineNotes,
        note: sheet.payload.note,
        opId: sheet.op_id,
        savedAt: sheet.updated_at,
      });
      setPendingExpected(sheet.payload.expected);
      setDraftSource("server");
    });
    return () => {
      cancelled = true;
    };
  }, [draftKey, legalEntityId]);

  useEffect(() => {
    if (!shouldAutosave(draftLoaded, dirty)) return;
    saveCountDraft(draftKey, { entries, lineNotes, note, opId });
  }, [draftKey, draftLoaded, dirty, entries, lineNotes, note, opId]);

  // Serverlagring er sekundær og skjer med ro: den skal ikke forstyrre tastingen.
  useEffect(() => {
    if (!draftLoaded || !legalEntityId || !user?.id) return;
    if (Object.keys(entries).length === 0) return;
    const payload: CountSheetPayload = { entries, lineNotes, expected: frozen, note };
    const t = setTimeout(() => {
      void saveCountSheet({
        legalEntityId,
        dateISO: osloTodayISO(),
        opId,
        payload,
        createdBy: user.id,
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [draftLoaded, legalEntityId, user?.id, entries, lineNotes, frozen, note, opId]);


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

  const locationFor = (id: string) => locations[id] ?? "";
  const setLocationFor = (id: string, value: string) => {
    setLocations(prev => ({ ...prev, [id]: value }));
    saveLocation(legalEntityId, id, value);
  };

  const unitsFor = (id: string): RawMaterialUnitRow[] => unitsQuery.data?.get(id) ?? [];
  /** Beholdningen linja skal måles mot: frosset verdi hvis den finnes. */
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

  const diffValue = filled.reduce((sum, r) => {
    const counted = countedBase(r);
    if (counted == null) return sum;
    return sum + (counted - expectedFor(r)) * (r.current_cost_price ?? 0);
  }, 0);

  // Lagrevakt: et påbegynt telleutkast skal ikke forsvinne ved en refresh.
  const hasDraft = Object.keys(entries).length > 0;
  useEffect(() => {
    if (!hasDraft) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasDraft]);

  const submit = async () => {
    if (apply.isPending) return;
    const lines = filled
      .map(r => ({
        raw_material_id: r.raw_material_id,
        counted_base: countedBase(r) as number,
        // Beholdningen telleren så da linja ble talt — frosset, ikke hentet på nytt.
        expected_base: expectedFor(r),
        line_note: (lineNotes[r.raw_material_id] ?? "").trim() || null,
      }))
      .filter(l => Number.isFinite(l.counted_base));
    if (lines.length === 0) return;
    try {
      const details = filled
        .map(r => {
          const n = (lineNotes[r.raw_material_id] ?? "").trim();
          return n ? `${r.name}: ${n}` : null;
        })
        .filter((x): x is string => !!x);
      const fullNote = [note.trim() || "Varetelling", ...details].join(" | ");
      const res = await apply.mutateAsync({ opId, lines, note: fullNote });
      setResult(res);
      // Utkastet tømmes kun når tellingen faktisk ble bokført, og neste telling
      // får en ny operasjons-ID.
      setEntries({});
      setLineNotes({});
      setFrozen({});
      setNote("");
      setOpId(newOpId());
      setDirty(false);
      clearCountDraft(draftKey);
    } catch {
      // Feilmeldingen vises av mutasjonen; utkastet og operasjons-ID-en beholdes,
      // slik at et nytt forsøk er trygt.
    }
  };


  /** Fyller 0 på alt som er synlig og ikke talt — «resten er tomt». */
  const setRestToZero = () => {
    setDirty(true);
    setEntries(prev => {
      const next = { ...prev };
      for (const r of visible) {
        const current = next[r.raw_material_id] ?? prev[r.raw_material_id];
        const hasValue = (current ?? []).some(row => row.amount.trim() !== "");
        if (!hasValue) {
          next[r.raw_material_id] = [{ amount: "0", unitKey: BASE_KEY }];
          freeze(r);
        }
      }
      return next;
    });
  };

  const countUnitText = (r: AllStockRow) => {
    const units = unitsFor(r.raw_material_id);
    const preferred = units.find(u => u.is_default_count) ?? units.find(u => u.is_default_purchase);
    if (!preferred || !Number(preferred.units_in_base)) return null;
    return `${formatNumber(r.current_stock / Number(preferred.units_in_base), 2)} ${preferred.unit_label}`;
  };

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner />

      {pendingDraft && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warning/50 p-4">
          <p className="text-sm">
            Du har en påbegynt telling fra i dag som ikke ble bokført
            {draftSource === "server" ? " (lagret på serveren)" : ""}.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDirty(false);
                clearCountDraft(draftKey);
                if (draftSource === "server") void discardCountSheet(pendingDraft.opId);
                setPendingDraft(null);
                setPendingExpected({});
              }}
            >
              Forkast
            </Button>
            <Button
              onClick={() => {
                setDirty(true);
                setEntries(pendingDraft.entries);
                setLineNotes(pendingDraft.lineNotes);
                setNote(pendingDraft.note);
                // Frosne forventede tall følger med, slik at konfliktkontrollen
                // fortsatt måler mot beholdningen da varen faktisk ble talt.
                setFrozen(pendingExpected);
                // Samme telling fortsetter på samme operasjons-ID.
                setOpId(pendingDraft.opId);
                setPendingDraft(null);
                setPendingExpected({});
              }}

            >
              Fortsett tellingen
            </Button>
          </div>
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
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Søk navn eller SKU…" className="h-11 pl-9" />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-11 w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle kategorier</SelectItem>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={itemType} onValueChange={setItemType}>
            <SelectTrigger className="h-11 w-[180px]"><SelectValue /></SelectTrigger>
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
        <div className="space-y-3">
          {visible.map(r => {
            const counted = countedBase(r);
            const diff = counted == null ? null : counted - expectedFor(r);
            return (
              <Card key={r.raw_material_id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[200px]">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-ink-secondary">
                      Bokført: {formatNumber(r.current_stock, 2)} {r.base_unit}
                      {countUnitText(r) && <> · {countUnitText(r)}</>}
                    </p>
                    <Input
                      value={locationFor(r.raw_material_id)}
                      onChange={e => setLocationFor(r.raw_material_id, e.target.value)}
                      placeholder="Lokasjon"
                      className="mt-2 h-9 text-sm"
                    />
                    <Input
                      value={lineNotes[r.raw_material_id] ?? ""}
                      onChange={e => {
                        setDirty(true);
                        setLineNotes(prev => ({ ...prev, [r.raw_material_id]: e.target.value }));
                      }}
                      placeholder="Notat"
                      className="mt-2 h-9 text-sm"
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
        </div>
      )}

      <Card className="sticky bottom-4 space-y-3 p-4 shadow-lg">
        <div>
          <Label className="text-xs">Notat på tellingen</Label>
          <Textarea value={note} onChange={e => { setDirty(true); setNote(e.target.value); }} rows={2} placeholder="F.eks. «Månedstelling tørrvarelager»" />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-secondary">
            {filled.length} varer talt opp. Varer uten tall hoppes over.
          </p>
          <Button variant="outline" className="w-full sm:w-auto" onClick={setRestToZero} disabled={!canWrite}>
            Sett resten til 0
          </Button>
          <Button className="w-full sm:w-auto" size="lg" disabled={!canWrite || filled.length === 0 || apply.isPending} onClick={submit}>
            {apply.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
            Bokfør telling
          </Button>
        </div>
      </Card>

      <Dialog open={!!result} onOpenChange={v => !v && setResult(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Telling bokført</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">
              {result?.adjusted ?? 0} varer justert, {result?.unchanged ?? 0} uendret.
            </p>
            {(result?.rows?.length ?? 0) > 0 && (
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-ink-secondary">
                    <tr><th className="pb-2">Vare</th><th className="pb-2 text-right">Differanse</th></tr>
                  </thead>
                  <tbody>
                    {result?.rows.map(row => (
                      <tr key={row.raw_material_id} className="border-t border-line-subtle">
                        <td className="py-2">{row.name ?? row.raw_material_id}</td>
                        <td className="py-2 text-right tabular-nums">{formatNumber(Number(row.diff ?? 0), 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setResult(null)}>Lukk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

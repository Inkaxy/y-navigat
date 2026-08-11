import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, ArrowLeft, FileText, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { nKr, nNum, nPct, parseNum } from "@/varer/lib/calcFormat";
import {
  ROUND_STATUS_META,
  rpcFeilmelding,
  useAddPriceRoundLines,
  useDeletePriceRoundLine,
  useGeneratePriceRoundLetters,
  useMarkLetterSent,
  usePriceRound,
  usePriceRoundLetters,
  usePriceRoundLines,
  usePublishPriceRound,
  useSetPriceRoundStatus,
  type PriceRoundLetter,
  type PriceRoundLine,
} from "@/varer/hooks/usePriceRounds";

function nDato(v: string | null | undefined) {
  return v ? new Date(v).toLocaleDateString("nb-NO") : "—";
}

function endringPct(line: PriceRoundLine) {
  if (!line.old_price || line.old_price <= 0) return null;
  return (line.new_price / line.old_price - 1) * 100;
}

const LETTER_STATUS: Record<string, { label: string; cls: string }> = {
  utkast: { label: "Utkast", cls: "bg-muted text-muted-foreground" },
  godkjent: { label: "Godkjent", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  sendt: { label: "Sendt", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

export default function PriceRoundDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const roundQuery = usePriceRound(id);
  const linesQuery = usePriceRoundLines(id);
  const lettersQuery = usePriceRoundLetters(id);

  const setStatus = useSetPriceRoundStatus();
  const publish = usePublishPriceRound();
  const generate = useGeneratePriceRoundLetters();
  const addLines = useAddPriceRoundLines();
  const deleteLine = useDeletePriceRoundLine();
  const markSent = useMarkLetterSent();

  const [dialog, setDialog] = useState<null | "godkjenn" | "publiser" | "forkast">(null);
  const [template, setTemplate] = useState("");
  const [templateRørt, setTemplateRørt] = useState(false);
  const [prosentband, setProsentband] = useState<string | null>(null);
  const [preview, setPreview] = useState<PriceRoundLetter | null>(null);

  const round = roundQuery.data ?? null;
  const lines = useMemo(() => linesQuery.data ?? [], [linesQuery.data]);
  const letters = lettersQuery.data ?? [];

  useEffect(() => {
    if (roundQuery.error) toast.error("Kunne ikke hente prisrunden");
  }, [roundQuery.error]);
  useEffect(() => {
    if (linesQuery.error) toast.error("Kunne ikke hente varelinjene");
  }, [linesQuery.error]);
  useEffect(() => {
    if (round?.letter_template && !templateRørt) setTemplate(round.letter_template);
  }, [round?.letter_template, templateRørt]);

  const status = round?.status ?? "utkast";
  const erUtkast = status === "utkast";
  const meta = ROUND_STATUS_META[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };

  const oppsummering = useMemo(() => {
    const overstyrte = lines.filter(
      (l) => l.nodvendig_pris != null && Number(l.new_price) !== Number(l.nodvendig_pris),
    ).length;
    const endringer = lines.map(endringPct).filter((v): v is number => v != null);
    const snitt = endringer.length
      ? endringer.reduce((s, v) => s + v, 0) / endringer.length
      : null;
    return { antall: lines.length, overstyrte, snitt };
  }, [lines]);

  const kjørStatus = async (action: "godkjenn" | "gjenapne" | "forkast") => {
    try {
      await setStatus.mutateAsync({ roundId: id!, action });
      toast.success(
        action === "godkjenn"
          ? "Prisrunden er godkjent"
          : action === "gjenapne"
          ? "Prisrunden er gjenåpnet"
          : "Prisrunden er forkastet",
      );
      setDialog(null);
    } catch (e) {
      toast.error(rpcFeilmelding(e, "Handlingen feilet"));
    }
  };

  const kjørPubliser = async () => {
    try {
      const res = await publish.mutateAsync(id!);
      toast.success(
        `Publisert: ${nNum(res?.lines_published ?? 0, 0)} priser gjelder fra ${nDato(
          res?.effective_date,
        )}`,
      );
      setDialog(null);
    } catch (e) {
      toast.error(rpcFeilmelding(e, "Publisering feilet"));
    }
  };

  const kjørGenerer = async () => {
    try {
      const res = await generate.mutateAsync({
        roundId: id!,
        template: template.trim() ? template : null,
      });
      setProsentband(res?.prosentband ?? null);
      toast.success(`${nNum(res?.letters ?? 0, 0)} brev generert`);
    } catch (e) {
      toast.error(rpcFeilmelding(e, "Kunne ikke generere brev"));
    }
  };

  if (roundQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  if (!round) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate("/varer/prisrunder")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Tilbake
        </Button>
        <p className="text-muted-foreground">Fant ikke prisrunden.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-16">
      <AppHeaderBanner
        title={round.name}
        subtitle={`Ikrafttredelse ${nDato(round.effective_date)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/varer/prisrunder")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Alle runder
            </Button>
            {erUtkast && (
              <Button size="sm" onClick={() => setDialog("godkjenn")} disabled={!lines.length}>
                Godkjenn
              </Button>
            )}
            {status === "godkjent" && (
              <>
                <Button size="sm" onClick={() => setDialog("publiser")}>
                  Publiser
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => kjørStatus("gjenapne")}
                  disabled={setStatus.isPending}
                >
                  Gjenåpne
                </Button>
              </>
            )}
            {(erUtkast || status === "godkjent") && (
              <Button size="sm" variant="destructive" onClick={() => setDialog("forkast")}>
                Forkast
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={cn("rounded px-2 py-0.5 text-[11px] font-medium", meta.cls)}>
          {meta.label}
        </span>
        <span className="text-muted-foreground">
          {nNum(oppsummering.antall, 0)} varer · {nNum(oppsummering.overstyrte, 0)} overstyrt · snitt
          endring {oppsummering.snitt == null ? "—" : nPct(oppsummering.snitt)}
        </span>
        {round.note && <span className="text-muted-foreground">· {round.note}</span>}
      </div>

      <Tabs defaultValue="varer">
        <TabsList>
          <TabsTrigger value="varer">Varer ({lines.length})</TabsTrigger>
          {(status === "godkjent" || status === "publisert") && (
            <TabsTrigger value="brev">Varslingsbrev</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="varer" className="mt-4">
          {linesQuery.isLoading ? (
            <Skeleton className="h-[400px] w-full" />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[1400px] text-sm">
                <thead className="bg-muted/50 text-xs">
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left font-medium">Vare</th>
                    <th className="px-2 py-2 text-left font-medium">Prisliste</th>
                    <th className="px-2 py-2 text-right font-medium">Gammel pris</th>
                    <th className="px-2 py-2 text-right font-medium">Nødvendig pris</th>
                    <th className="px-2 py-2 text-right font-medium">Ny pris</th>
                    <th className="px-2 py-2 text-right font-medium">Endring %</th>
                    <th className="px-2 py-2 text-right font-medium">Brutto før → etter</th>
                    <th className="px-2 py-2 text-right font-medium">DG2 før → etter</th>
                    <th className="px-2 py-2 text-left font-medium">Kvalitet</th>
                    <th className="px-2 py-2 text-left font-medium">Begrunnelse</th>
                    {erUtkast && <th className="w-10 px-2 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <LineRow
                      key={l.id}
                      line={l}
                      editable={erUtkast}
                      saving={addLines.isPending}
                      onSave={async (newPrice, reason) => {
                        try {
                          await addLines.mutateAsync({
                            roundId: id!,
                            items: [
                              {
                                product_id: l.product_id,
                                price_list_id: l.price_list_id,
                                new_price: newPrice,
                                reason,
                              },
                            ],
                          });
                          toast.success("Linjen er lagret");
                        } catch (e) {
                          toast.error(rpcFeilmelding(e, "Kunne ikke lagre linjen"));
                        }
                      }}
                      onDelete={async () => {
                        try {
                          await deleteLine.mutateAsync({ lineId: l.id, roundId: id! });
                          toast.success("Linjen er fjernet");
                        } catch (e) {
                          toast.error(rpcFeilmelding(e, "Kunne ikke fjerne linjen"));
                        }
                      }}
                    />
                  ))}
                  {!lines.length && (
                    <tr>
                      <td colSpan={11} className="px-3 py-12 text-center text-muted-foreground">
                        Ingen varer i runden. Legg til varer fra lønnsomhetsarket.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="brev" className="mt-4 space-y-4">
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-2 text-sm font-semibold">Brevmal</div>
            <Textarea
              rows={10}
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value);
                setTemplateRørt(true);
              }}
              placeholder="La feltet stå tomt for å bruke standardmalen fra serveren."
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Tillatte flettefelt: <code>{"{{kundenavn}}"}</code>{" "}
              <code>{"{{ikrafttredelsesdato}}"}</code> <code>{"{{varslingsdato}}"}</code>{" "}
              <code>{"{{prosentband}}"}</code> <code>{"{{selskap}}"}</code>. Ukjente flettefelt
              fjernes automatisk.
            </p>
            <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              Brevet kan aldri inneholde kostpriser, marginer eller enkeltvarer — grunnlaget er
              teknisk avgrenset.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <Button size="sm" onClick={kjørGenerer} disabled={generate.isPending}>
                <FileText className="mr-1.5 h-4 w-4" />
                Generer brev
              </Button>
              {prosentband && (
                <span className="text-sm text-muted-foreground">
                  Prosentbånd: <strong className="text-foreground">{prosentband}</strong>
                </span>
              )}
              {round.letters_generated_at && (
                <span className="text-xs text-muted-foreground">
                  Sist generert {nDato(round.letters_generated_at)}
                </span>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium">Kunde</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Sendt</th>
                  <th className="px-3 py-2 text-right font-medium">Handling</th>
                </tr>
              </thead>
              <tbody>
                {letters.map((b) => {
                  const s = LETTER_STATUS[b.status] ?? {
                    label: b.status,
                    cls: "bg-muted text-muted-foreground",
                  };
                  return (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{b.customer_name}</td>
                      <td className="px-3 py-2">
                        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", s.cls)}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{nDato(b.sent_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => setPreview(b)}>
                          Forhåndsvis
                        </Button>
                        {b.status !== "sendt" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-2"
                            disabled={markSent.isPending}
                            onClick={async () => {
                              try {
                                await markSent.mutateAsync({ letterId: b.id, roundId: id! });
                                toast.success("Brevet er markert som sendt");
                              } catch (e) {
                                toast.error(rpcFeilmelding(e, "Kunne ikke oppdatere brevet"));
                              }
                            }}
                          >
                            Marker som sendt
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!letters.length && (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                      Ingen brev generert ennå.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* forhåndsvisning */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.customer_name}</DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap font-sans text-sm">{preview?.body}</pre>
        </DialogContent>
      </Dialog>

      {/* godkjenn */}
      <Dialog open={dialog === "godkjenn"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Godkjenn prisrunden?</DialogTitle>
            <DialogDescription>
              {nNum(oppsummering.antall, 0)} varer · {nNum(oppsummering.overstyrte, 0)} overstyrte
              priser · snitt endring{" "}
              {oppsummering.snitt == null ? "—" : nPct(oppsummering.snitt)}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Avbryt
            </Button>
            <Button onClick={() => kjørStatus("godkjenn")} disabled={setStatus.isPending}>
              Godkjenn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* publiser */}
      <Dialog open={dialog === "publiser"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publiser prisrunden?</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Publisering skriver de nye prisene til prislistene fra {nDato(round.effective_date)}.
              Dette er den eneste handlingen i systemet som endrer priser.
            </span>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Avbryt
            </Button>
            <Button onClick={kjørPubliser} disabled={publish.isPending}>
              Publiser
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* forkast */}
      <Dialog open={dialog === "forkast"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forkast prisrunden?</DialogTitle>
            <DialogDescription>
              Runden blir liggende som historikk, men kan ikke publiseres.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Avbryt
            </Button>
            <Button
              variant="destructive"
              onClick={() => kjørStatus("forkast")}
              disabled={setStatus.isPending}
            >
              Forkast
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------------------------------------------------------- rad */

function LineRow({
  line,
  editable,
  saving,
  onSave,
  onDelete,
}: {
  line: PriceRoundLine;
  editable: boolean;
  saving: boolean;
  onSave: (newPrice: number, reason: string | null) => void;
  onDelete: () => void;
}) {
  const [pris, setPris] = useState(String(line.new_price ?? ""));
  const [reason, setReason] = useState(line.reason ?? "");

  useEffect(() => {
    setPris(String(line.new_price ?? ""));
    setReason(line.reason ?? "");
  }, [line.new_price, line.reason]);

  const endring = endringPct(line);
  const overstyrt =
    line.nodvendig_pris != null && Number(line.new_price) !== Number(line.nodvendig_pris);

  const lagre = () => {
    const p = parseNum(pris);
    if (p == null || p <= 0) return;
    if (p === Number(line.new_price) && (reason || null) === (line.reason ?? null)) return;
    onSave(p, reason.trim() || null);
  };

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-2 py-1.5">
        <div className="font-medium">{line.products?.navn ?? "—"}</div>
        <div className="text-xs text-muted-foreground">
          Varenr {line.products?.display_number ?? "—"}
          {overstyrt && (
            <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300">
              overstyrt
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-1.5 text-muted-foreground">{line.price_lists?.display_name ?? "—"}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {line.old_price == null ? "—" : nKr(line.old_price)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {line.nodvendig_pris == null ? "—" : nKr(line.nodvendig_pris)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {editable ? (
          <Input
            value={pris}
            onChange={(e) => setPris(e.target.value)}
            onBlur={lagre}
            inputMode="decimal"
            disabled={saving}
            className="h-7 w-[92px] text-right text-xs"
          />
        ) : (
          <strong>{nKr(line.new_price)}</strong>
        )}
      </td>
      <td
        className={cn(
          "px-2 py-1.5 text-right tabular-nums",
          endring == null
            ? "text-muted-foreground"
            : endring < 0
            ? "text-destructive"
            : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {endring == null ? "—" : nPct(endring)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {line.brutto_for == null ? "—" : nNum(line.brutto_for, 1)} →{" "}
        {line.brutto_etter == null ? "—" : nNum(line.brutto_etter, 1)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {line.dg2_for == null ? "—" : nNum(line.dg2_for, 1)} →{" "}
        {line.dg2_etter == null ? "—" : nNum(line.dg2_etter, 1)}
      </td>
      <td className="px-2 py-1.5">{line.kvalitet ?? "—"}</td>
      <td className="px-2 py-1.5">
        {editable ? (
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={lagre}
            placeholder="Begrunnelse"
            disabled={saving}
            className="h-7 w-[200px] text-xs"
          />
        ) : (
          <span className="text-muted-foreground">{line.reason ?? "—"}</span>
        )}
      </td>
      {editable && (
        <td className="px-2 py-1.5 text-right">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </td>
      )}
    </tr>
  );
}

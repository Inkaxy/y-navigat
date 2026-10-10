import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLineMatchForm } from "@/fakturaer/hooks/useLineMatchForm";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ExternalLink, Search, Plus } from "lucide-react";
import { toast } from "sonner";
import { showError } from "@/lib/userError";
import { invalidateInvoice } from "@/ravarer/lib/invalidate";
import { formatNok, formatDate } from "@/fakturaer/lib/constants";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { CANONICAL_BASE_UNITS, CANONICAL_PACKAGE_UNITS, parseDecimal } from "@/fakturaer/lib/units";
import { CreateRawMaterialFromLine } from "@/fakturaer/components/CreateRawMaterialFromLine";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import { InvoiceDocumentButton } from "@/fakturaer/components/InvoiceDocumentButton";
import { recalculateLines, startPriceOutcomeLabel } from "@/fakturaer/lib/acceptMatch";
import { Sparkles } from "lucide-react";
import { OpenSupplierItemButton } from "@/fakturaer/components/supplier-item/OpenSupplierItemButton";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  line: ReviewLineRow | null;
  /**
   * Kalles etter «Godta og neste». Skuffen holdes åpen slik at brukeren kan
   * jobbe seg gjennom køen uten å lukke og åpne på nytt.
   */
  onAcceptedNext?: () => void;
}

export function MatchDrawer({ open, onOpenChange, line, onAcceptedNext }: Props) {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  // Samme skjema og lagring som kontrollflaten i køen. Nullstilles når skuffen åpnes.
  const form = useLineMatchForm(open ? line : null, open);
  const {
    selectedRmId, setSelectedRmId, search, setSearch, rmResults, searching, suggestions, suggestionLinks,
    selectedRm, linkExists, anyPrimary, rememberSku, setRememberSku, rememberName, setRememberName,
    setAsPrimary, setSetAsPrimary, confirmPackage, setConfirmPackage, agreedPrice, setAgreedPrice,
    packageSize, setPackageSize, packageUnit, setPackageUnit, cost, linePricePerBaseUnit, busy,
    aiBusy, aiSuggestion, aiNotice, runAiSuggestion,
  } = form;

  async function performMatch(applyToAll: boolean, keepOpen = false) {
    if (!line || !selectedRmId) return;
    try {
      const { lineIds, startPrice, recalculationPending, recalculationError } = await form.save({ applyToAll });
      const antall = lineIds.length;
      const startPriceNote = startPriceOutcomeLabel(startPrice) ?? undefined;
      const invoiceId = line.invoice_id;
      if (recalculationPending) {
        toast.warning(`Koblingen er lagret, men prisen er ikke regnet om for ${antall} ${antall === 1 ? "linje" : "linjer"}`, {
          description: [recalculationError, startPriceNote].filter(Boolean).join(" ") || undefined,
          duration: 15000,
          action: {
            label: "Prøv igjen",
            onClick: () => {
              void (async () => {
                try {
                  await recalculateLines(invoiceId, lineIds);
                  toast.success("Prisen er regnet om");
                  invalidateInvoice(qc, invoiceId);
                } catch (err: unknown) {
                  showError("faktura-match", err, "Reberegningen feilet fortsatt");
                }
              })();
            },
          },
        });
      } else {
        toast.success(applyToAll ? `Matchet ${antall} ${antall === 1 ? "linje" : "linjer"}` : "Linje matchet", {
          description: startPriceNote,
        });
      }
      if (recalculationPending) {
        // Skuffen blir stående åpen så brukeren ser at noe gjenstår.
      } else if (keepOpen && onAcceptedNext) {
        setSelectedRmId(null);
        setSearch("");
        onAcceptedNext();
      } else {
        onOpenChange(false);
      }
    } catch (e: unknown) {
      showError("faktura-match", e, "Kunne ikke matche linjen");
    }
  }

  if (!line) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-[60vw] sm:max-w-[60vw] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Match fakturalinje</SheetTitle>
          <div className="pt-1">
            <InvoiceDocumentButton path={line?.invoice.source_document_url} label="Åpne faktura" />
          </div>
        </SheetHeader>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
          {/* Left – context */}
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-lg font-semibold">{line.invoice.supplier?.name}</div>
              <div className="text-ink-secondary">Faktura {line.invoice.invoice_number} • {formatDate(line.invoice.invoice_date)}</div>
            </div>
            <dl className="space-y-2 rounded-lg border border-line-subtle bg-muted/20 p-4">
              <KV k="SKU" v={line.supplier_sku ?? "—"} mono />
              <KV k="Beskrivelse" v={line.description ?? "—"} />
              <KV k="Mengde" v={`${line.quantity ?? "—"} ${line.unit ?? ""}`} />
              <KV k="Pris/enhet" v={formatNok(line.unit_price)} />
              <KV k="Sum" v={formatNok(line.total_amount)} />
            </dl>
            {line.invoice.source_document_url && (
              <a href={line.invoice.source_document_url} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> Originaldokument
              </a>
            )}
            <OpenSupplierItemButton supplierId={line.invoice.supplier_id} line={line} />
          </div>

          {/* Right – matching */}
          <div className="space-y-5">
            {/*
              AI-hjelp er valgfri og hentes på forespørsel. «AI-forslag» vises kun
              når svaret faktisk kommer fra modellen — regelforslagene under heter
              «Foreslåtte matcher» og er noe annet.
            */}
            <div className="rounded-lg border border-line-subtle p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">AI-hjelp</span>
                <Button type="button" variant="outline" size="sm" onClick={runAiSuggestion} disabled={aiBusy || busy}>
                  {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Hent AI-forslag
                </Button>
              </div>
              {aiNotice && <p className="mt-2 text-xs text-ink-secondary">{aiNotice}</p>}
              {aiSuggestion && (
                <div className="mt-2 space-y-1 rounded-md bg-muted/40 p-2 text-xs">
                  <div className="font-medium">
                    AI-forslag{aiSuggestion.confidence != null ? ` • ${Math.round(aiSuggestion.confidence * 100)}% sikkerhet` : ""}
                  </div>
                  {aiSuggestion.explanation && <p>{aiSuggestion.explanation}</p>}
                  {aiSuggestion.uncertainties.length > 0 && (
                    <ul className="list-disc pl-4 text-ink-secondary">
                      {aiSuggestion.uncertainties.map((u) => <li key={u}>{u}</li>)}
                    </ul>
                  )}
                  <p className="text-ink-secondary">
                    Forslaget er en gjetning og er ikke bekreftet. Du bekrefter vare og pakning selv.
                  </p>
                </div>
              )}
            </div>

            {suggestions.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">Foreslåtte matcher</h4>
                <RadioGroup value={selectedRmId ?? ""} onValueChange={(v) => setSelectedRmId(v)} className="space-y-2">
                  {suggestions.map((s) => {
                    const link = suggestionLinks?.get(s.raw_material_id) ?? null;
                    return (
                      <label key={s.raw_material_id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-subtle p-3 hover:bg-muted/30">
                        <RadioGroupItem value={s.raw_material_id} className="mt-1" />
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5 font-medium">
                            {s.raw_material?.name ?? "Ukjent"}
                            <ItemTypeBadge itemType={s.raw_material?.item_type} />
                          </div>
                          <div className="mt-0.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-ink-secondary sm:grid-cols-4">
                            <span>
                              Lev-SKU:{" "}
                              <span className="font-mono">{link?.supplier_sku ?? "—"}</span>
                            </span>
                            <span>
                              Siste pris: {link?.last_invoice_price != null ? formatNok(link.last_invoice_price) : "—"}
                              {link?.last_invoice_date ? ` (${formatDate(link.last_invoice_date)})` : ""}
                            </span>
                            <span>
                              Avtalepris:{" "}
                              {link?.agreed_price_per_base_unit != null
                                ? `${formatNok(link.agreed_price_per_base_unit)} / ${s.raw_material?.base_unit ?? "enhet"}`
                                : "—"}
                            </span>
                            <span>
                              Pakning:{" "}
                              {link?.package_size != null ? `${link.package_size} ${link.package_unit ?? ""}`.trim() : "—"}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-ink-secondary">
                            {s.match_reason} • {Math.round(s.confidence * 100)}%
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </RadioGroup>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Label>Søk etter vare</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Opprett ny vare
                </Button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Navn eller SKU — søker i alle varetyper…" className="pl-9" />
              </div>
              {searching && <Loader2 className="mx-auto my-3 h-4 w-4 animate-spin text-ink-secondary" />}
              {rmResults.length > 0 && (
                <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-line-subtle">
                  {rmResults.map((r) => (
                    <button key={r.id} type="button"
                      onClick={() => { setSelectedRmId(r.id); setSearch(r.name); }}
                      className="flex w-full items-center justify-between gap-3 border-b border-line-subtle p-2.5 text-left text-sm last:border-0 hover:bg-muted/40">
                      <div>
                        <div className="flex items-center gap-1.5 font-medium">
                          {r.name}
                          <ItemTypeBadge itemType={r.item_type} />
                        </div>
                        <div className="text-xs text-ink-secondary">{r.sku ?? "—"} • {r.category ?? "—"}</div>
                      </div>
                      <div className="text-xs tabular-nums text-ink-secondary">{formatNok(r.current_cost_price)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedRm && (
              <div className="rounded-lg border border-line-subtle p-4">
                <div className="flex items-center gap-1.5 font-medium">
                  {selectedRm.name}
                  <ItemTypeBadge itemType={selectedRm.item_type} />
                </div>
                <div className="text-xs text-ink-secondary">{selectedRm.category ?? "—"} • {selectedRm.sku ?? "—"}</div>
                <div className="mt-3 text-sm">
                  {linkExists ? (
                    <div className="text-success">✅ Denne leverandøren er allerede knyttet til råvaren</div>
                  ) : (
                    <div className="text-warning">⚠️ Ny leverandørkobling vil opprettes</div>
                  )}
                </div>
                <div className="mt-4 space-y-3 rounded-md border border-line-subtle bg-muted/20 p-3">
                  <div>
                    <Label className="text-xs">
                      Avtalepris pr {selectedRm.base_unit ?? "baseenhet"} hos denne leverandøren
                    </Label>
                    <Input
                      className="mt-1 h-8"
                      value={agreedPrice}
                      onChange={(e) => setAgreedPrice(e.target.value)}
                      placeholder="tom = ingen avtale registrert"
                    />
                    <p className="mt-1 text-xs text-ink-secondary">tom = ingen avtale registrert</p>
                  </div>
                  <div className="text-xs text-ink-secondary">
                    Kostpris pr {selectedRm.base_unit ?? "baseenhet"} fra denne fakturalinjen:{" "}
                    <span className="font-medium text-ink">
                      {linePricePerBaseUnit != null ? formatNok(linePricePerBaseUnit) : "kunne ikke beregnes"}
                    </span>
                    {cost && (
                      <p className={`mt-1 ${cost.needsInput || cost.confidenceLevel === "low" ? "text-warning" : ""}`}>
                        {cost.needsInput ? cost.reason : cost.explanation}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Pakningsstørrelse</Label>
                      <Input className="mt-1 h-8" value={packageSize} onChange={(e) => setPackageSize(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Pakningsenhet</Label>
                      <Select value={packageUnit} onValueChange={setPackageUnit}>
                        <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Velg" /></SelectTrigger>
                        <SelectContent>
                          {[...CANONICAL_BASE_UNITS, ...CANONICAL_PACKAGE_UNITS].map((u) => (
                            <SelectItem key={u} value={u}>{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <label className="flex items-start gap-2">
                    <Checkbox checked={rememberSku} onCheckedChange={(v) => setRememberSku(!!v)} disabled={!line.supplier_sku} />
                    <span>Husk SKU <code className="rounded bg-muted px-1">{line.supplier_sku ?? "—"}</code> for denne leverandøren</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Checkbox checked={rememberName} onCheckedChange={(v) => setRememberName(!!v)} disabled={!line.description} />
                    <span>Husk produktnavn «{line.description}» for denne leverandøren</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Checkbox checked={confirmPackage} onCheckedChange={(v) => setConfirmPackage(!!v)} />
                    <span>
                      Bekreft pakningen for denne leverandøren
                      {cost?.baseUnitsPerPackage
                        ? ` (${cost.baseUnitsPerPackage} ${selectedRm?.base_unit ?? ""} per pakning)`
                        : ""}
                      <span className="block text-xs text-ink-secondary">
                        Uten avkrysning brukes pakningen kun som forslag ved senere fakturaer.
                      </span>
                    </span>
                  </label>
                  {!anyPrimary && (
                    <label className="flex items-start gap-2">
                      <Checkbox checked={setAsPrimary} onCheckedChange={(v) => setSetAsPrimary(!!v)} />
                      <span>Sett denne leverandøren som primær for råvaren</span>
                    </label>
                  )}
                </div>
              </div>
            )}

            {selectedRmId && (
              /* Én informert hovedhandling: brukeren ser hva som faktisk lagres. */
              <div className="rounded-lg border border-line-subtle bg-muted/20 p-3 text-xs">
                <div className="mb-1 text-sm font-semibold">Dette lagres når du bekrefter</div>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li>Bekreftet kobling mellom linjen og «{selectedRm?.name ?? "valgt vare"}»</li>
                  <li>
                    Pakning: {packageSize ? `${packageSize} ${packageUnit || ""}`.trim() : "ikke satt"}
                    {confirmPackage ? " (bekreftet for leverandøren)" : " (kun som forslag)"}
                  </li>
                  <li>
                    Avtalepris: {parseDecimal(agreedPrice) != null
                      ? `${formatNok(parseDecimal(agreedPrice) as number)} per ${selectedRm?.base_unit ?? "enhet"}`
                      : "uendret"}
                  </li>
                  <li>
                    Startpris: lagres bare hvis innstillingen er på, det ikke finnes avtalepris eller startpris
                    fra før, og serveren godkjenner grunnlaget.
                  </li>
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button onClick={() => performMatch(false)} disabled={!selectedRmId || busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Bekreft match
              </Button>
              {onAcceptedNext && (
                <Button variant="outline" onClick={() => performMatch(false, true)} disabled={!selectedRmId || busy}>
                  Godta og neste
                </Button>
              )}
              <Button variant="outline" onClick={() => performMatch(true)} disabled={!selectedRmId || busy}>
                Bekreft og bruk på alle like linjer
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Avbryt</Button>
            </div>
          </div>
        </div>

        <CreateRawMaterialFromLine
          open={createOpen}
          onOpenChange={setCreateOpen}
          line={line}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] });
            qc.invalidateQueries({ queryKey: ["fakturaer-review-count"] });
            onOpenChange(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-secondary">{k}</dt>
      <dd className={mono ? "font-mono text-xs" : "font-medium"}>{v}</dd>
    </div>
  );
}

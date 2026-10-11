import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { invalidateRavarerCounts, invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { osloTodayISO } from "@/lib/osloDate";
import { parseDecimal } from "@/ravarer/lib/packageMath";
import { agreementBaseUnitsPerPackage } from "@/ravarer/lib/agreementPricing";
import { agreementFormError, derivePricePerBaseUnit } from "@/ravarer/lib/agreementForm";
import type { AgreementPayload } from "@/ravarer/lib/rpcContracts";
import { parseApplyAgreementResult } from "@/ravarer/lib/agreementResult";
import {
  clearPendingAgreement, pendingAgreementFor, reconcileAgreement, rememberPendingAgreement, subscribePendingAgreements,
} from "@/ravarer/lib/agreementRecovery";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultRawMaterialId?: string;
  defaultSupplierId?: string;
}

export function NewAgreementDialog({ open, onOpenChange, defaultRawMaterialId, defaultSupplierId }: Props) {
  const qc = useQueryClient();
  const { legalEntityId, user, canWrite } = useRavarer();
  const { data: rms = [] } = useRawMaterials();
  const { data: suppliers = [] } = useSuppliers();

  const [rawMaterialId, setRawMaterialId] = useState<string>(defaultRawMaterialId ?? "");
  const [supplierId, setSupplierId] = useState<string>(defaultSupplierId ?? "");
  const [supplierSku, setSupplierSku] = useState("");
  const [supplierProductName, setSupplierProductName] = useState("");
  const [agreedPrice, setAgreedPrice] = useState<string>("");
  const [packageSize, setPackageSize] = useState<string>("");
  const [packageUnit, setPackageUnit] = useState<string>("kg");
  const [baseUnitsPerPackage, setBaseUnitsPerPackage] = useState<string>("");
  const [pricePerBaseUnit, setPricePerBaseUnit] = useState<string>("");
  const [pricePerBaseUnitTouched, setPricePerBaseUnitTouched] = useState(false);
  /** Om prisen brukeren skriver inn gjelder hele pakningen eller én grunnenhet. */
  const [priceBasis, setPriceBasis] = useState<"package" | "base">("package");
  const [validFrom, setValidFrom] = useState<string>(osloTodayISO());
  const [validTo, setValidTo] = useState<string>("");
  const [setPrimary, setSetPrimary] = useState(true);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [rmOpen, setRmOpen] = useState(false);
  /** Avstemming av et uavklart utfall: lest kobling sammenlignes med det frosne innholdet. */
  const [recon, setRecon] = useState<"idle" | "reading" | "error" | "not_observed">("idle");
  /** Synkron lås: to klikk i samme render skal aldri gi to kall. */
  const busyRef = useRef(false);
  /** Økes når dialogen åpnes på nytt eller konteksten byttes; foreldede fullføringer ignoreres. */
  const genRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; genRef.current += 1; }; }, []);
  const liveRef = useRef({ open, legalEntityId, canWrite, rawMaterialId, supplierId });
  liveRef.current = { open, legalEntityId, canWrite, rawMaterialId, supplierId };
  // Uavklart utfall lever utenfor skjemaet: lukk/åpne nullstiller det ikke.
  const pending = useSyncExternalStore(subscribePendingAgreements, () => pendingAgreementFor(legalEntityId, rawMaterialId, supplierId));
  useEffect(() => { setRecon("idle"); }, [pending]);

  useEffect(() => {
    if (open) {
      setRawMaterialId(defaultRawMaterialId ?? "");
      setSupplierId(defaultSupplierId ?? "");
      setSupplierSku(""); setSupplierProductName("");
      setAgreedPrice(""); setPackageSize(""); setPackageUnit("kg"); setPriceBasis("package"); setBaseUnitsPerPackage("");
      setPricePerBaseUnit(""); setPricePerBaseUnitTouched(false);
      setValidFrom(osloTodayISO()); setValidTo("");
      setSetPrimary(true); setDocFile(null);
      setRecon("idle");
    }
    genRef.current += 1;
  }, [open, defaultRawMaterialId, defaultSupplierId, legalEntityId]);

  const selectedRm = useMemo(() => rms.find((r) => r.id === rawMaterialId), [rms, rawMaterialId]);
  const activeRms = useMemo(() => rms.filter((r) => r.is_active), [rms]);

  // Grunnenheter per pakning avgjør prisen — ikke pakningstallet. En sekk
  // oppgitt som «1 stk» med 25 kg innhold skal gi kilopris, ikke sekkepris.
  const unitsPerPackage = useMemo(
    () => agreementBaseUnitsPerPackage(baseUnitsPerPackage, packageSize, packageUnit, selectedRm?.base_unit ?? null),
    [baseUnitsPerPackage, packageSize, packageUnit, selectedRm?.base_unit],
  );

  // Auto-beregn pris pr grunnenhet ut fra hva prisen gjelder.
  // Avledet verdi følger alltid gyldig, gjeldende input; ugyldig input tømmer den (aldri gammel 10 kr/kg).
  useEffect(() => {
    if (pricePerBaseUnitTouched) return;
    setPricePerBaseUnit(derivePricePerBaseUnit(agreedPrice, priceBasis, unitsPerPackage));
  }, [agreedPrice, unitsPerPackage, priceBasis, pricePerBaseUnitTouched]);
  // Manuell overstyring er bundet til råvaren/grunnenheten den ble skrevet for.
  useEffect(() => {
    setPricePerBaseUnitTouched(false);
  }, [rawMaterialId, selectedRm?.base_unit]);

  interface Frozen { gen: number; entityId: string; rawMaterialId: string; payloadBase: Omit<AgreementPayload, "agreement_document_url">; docFile: File | null }
  type Outcome = { kind: "saved"; frozen: Frozen } | { kind: "stale"; frozen: Frozen };

  /** Sjekk at dialogen fortsatt viser samme mål med skrivetilgang før neste sideeffekt. */
  const stillCurrent = (f: Frozen) =>
    mountedRef.current && genRef.current === f.gen && liveRef.current.open && liveRef.current.legalEntityId === f.entityId && liveRef.current.canWrite &&
    liveRef.current.rawMaterialId === f.payloadBase.raw_material_id && liveRef.current.supplierId === f.payloadBase.supplier_id;

  const create = useMutation({
    mutationFn: async (f: Frozen): Promise<Outcome> => {
      let docUrl: string | null = null;
      if (f.docFile) {
        if (!stillCurrent(f)) return { kind: "stale", frozen: f };
        const path = `${f.entityId}/${f.payloadBase.supplier_id}_${Date.now()}_${f.docFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("supplier-agreements").upload(path, f.docFile);
        if (upErr) throw new KnownError("Dokumentet kunne ikke lastes opp. Avtalen er ikke lagret.");
        docUrl = path;
      }
      // Kontekst kan ha endret seg mens opplastingen pågikk: ikke start lagring for et annet mål.
      if (!stillCurrent(f)) return { kind: "stale", frozen: f };
      // Én transaksjon i basen: da kan avtalen ikke bli halvveis lagret med to primærleverandører.
      const payload: AgreementPayload = { ...f.payloadBase, agreement_document_url: docUrl };
      let res: { data: unknown; error: { code?: string } | null };
      try {
        res = await supabase.rpc("rm_apply_agreement", { p_payload: payload as unknown as never });
      } catch {
        throw new UnknownOutcomeError(payload, docUrl);
      }
      if (res.error) {
        // SQL-avvisning (tilgang/validering) avbryter transaksjonen. Uten kode vet vi ikke.
        if (res.error.code) throw new KnownError("Avtalen ble avvist og er ikke lagret.");
        throw new UnknownOutcomeError(payload, docUrl);
      }
      if (!parseApplyAgreementResult(res.data)) throw new UnknownOutcomeError(payload, docUrl);
      return { kind: "saved", frozen: f };
    },
    onSuccess: (out) => {
      if (out.kind === "stale") {
        toast.message("Avtalen ble ikke lagret fordi skjemaet eller tilgangen endret seg.");
        return;
      }
      // Bekreftet lagring: invalidering bindes til det frosne målet, uansett hva dialogen viser nå.
      invalidateRawMaterial(qc, out.frozen.rawMaterialId);
      invalidateRavarerCounts(qc);
      if (!mountedRef.current || genRef.current !== out.frozen.gen) return; // ikke lukk et annet skjema
      toast.success("Avtale lagret");
      onOpenChange(false);
    },
    onError: (e: unknown, f) => {
      if (e instanceof UnknownOutcomeError) {
        // Lagringen kan ha gått gjennom. Behold utkastet, les på nytt før noe annet.
        invalidateRawMaterial(qc, f.rawMaterialId);
        // Bevares utenfor skjemaet (frosset mål, innhold og dokumentsti) til det er avstemt.
        rememberPendingAgreement({ entityId: f.entityId, payload: e.payload, documentPath: e.documentPath, at: new Date().toISOString() });
        toast.error("Ukjent utfall: avtalen kan være lagret. Kontroller den lagrede avtalen før du lagrer igjen.");
        return;
      }
      toast.error(e instanceof KnownError ? e.message : "Kunne ikke lagre avtalen.");
    },
    onSettled: () => { busyRef.current = false; },
  });

  const submit = () => {
    if (busyRef.current || pending) return;
    if (!canWrite) { toast.error("Du har ikke skrivetilgang."); return; }
    if (!rawMaterialId) { toast.error("Velg råvare"); return; }
    if (!supplierId) { toast.error("Velg leverandør"); return; }
    // Valider før opplasting, så et ugyldig skjema aldri etterlater en foreldreløs fil.
    const invalid = agreementFormError({ agreedPrice, pricePerBaseUnit, validFrom, validTo });
    if (invalid) { toast.error(invalid); return; }
    const entered = parseDecimal(agreedPrice);
    const ap =
      priceBasis === "package"
        ? entered
        : entered != null && unitsPerPackage != null && unitsPerPackage > 0 ? entered * unitsPerPackage : null;
    busyRef.current = true;
    create.mutate({
      gen: genRef.current,
      entityId: legalEntityId,
      rawMaterialId,
      docFile,
      payloadBase: {
        raw_material_id: rawMaterialId,
        supplier_id: supplierId,
        supplier_sku: supplierSku.trim() || null,
        supplier_product_name: supplierProductName.trim() || null,
        agreed_price: ap,
        agreed_price_per_base_unit: parseDecimal(pricePerBaseUnit),
        package_size: parseDecimal(packageSize),
        package_unit: packageUnit || null,
        base_units_per_package: parseDecimal(baseUnitsPerPackage),
        agreement_valid_from: validFrom || null,
        agreement_valid_to: validTo || null,
        agreement_priority: null,
        is_primary: setPrimary,
      },
    });
  };

  /** Les nøyaktig kobling for det frosne målet og sammenlign. Aldri automatisk nytt `rm_apply_agreement`. */
  const reconcile = async () => {
    const p = pending;
    if (!p || recon === "reading") return;
    const startGen = genRef.current;
    setRecon("reading");
    const { data, error } = await supabase
      .from("raw_material_suppliers")
      .select("agreed_price, agreed_price_per_base_unit, agreement_valid_from, agreement_valid_to, agreement_document_url")
      .eq("raw_material_id", p.payload.raw_material_id)
      .eq("supplier_id", p.payload.supplier_id)
      .limit(2);
    if (!mountedRef.current || pendingAgreementFor(p.entityId, p.payload.raw_material_id, p.payload.supplier_id) !== p) return;
    // Dialogen kan vise et annet mål nå: avstemmingen for A gjelder fortsatt A, men rører aldri B sitt skjema.
    const sameEditor =
      genRef.current === startGen && liveRef.current.open && liveRef.current.legalEntityId === p.entityId &&
      liveRef.current.rawMaterialId === p.payload.raw_material_id && liveRef.current.supplierId === p.payload.supplier_id;
    if (error || !data || data.length > 1) { if (sameEditor) setRecon("error"); return; }
    if (reconcileAgreement(p, data[0] ?? null) === "saved") {
      clearPendingAgreement(p);
      invalidateRawMaterial(qc, p.payload.raw_material_id);
      invalidateRavarerCounts(qc);
      if (!sameEditor) return;
      toast.success("Avtalen var lagret.");
      onOpenChange(false);
      return;
    }
    if (sameEditor) setRecon("not_observed");
  };

  const targetLocked = create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ny avtale</DialogTitle>
          <DialogDescription>Knytt en leverandør til en råvare med avtalt pris og gyldighet.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Vare *</Label>
            <Popover open={rmOpen} onOpenChange={setRmOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  disabled={!!defaultRawMaterialId || targetLocked}
                  className="w-full justify-between font-normal"
                >
                  <span className="truncate">
                    {selectedRm ? `${selectedRm.name} (${selectedRm.sku})` : "Velg vare…"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Søk navn eller SKU…" />
                  <CommandList>
                    <CommandEmpty>Ingen treff</CommandEmpty>
                    <CommandGroup>
                      {activeRms.map((r) => (
                        <CommandItem
                          key={r.id}
                          value={`${r.name} ${r.sku}`}
                          onSelect={() => { setRawMaterialId(r.id); setRmOpen(false); }}
                        >
                          <Check className={rawMaterialId === r.id ? "mr-2 h-4 w-4 opacity-100" : "mr-2 h-4 w-4 opacity-0"} />
                          <span className="truncate">{r.name}</span>
                          <span className="ml-2 font-mono text-xs text-ink-secondary">{r.sku}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="col-span-2">
            <Label>Leverandør *</Label>
            <Select value={supplierId} onValueChange={setSupplierId} disabled={!!defaultSupplierId || targetLocked}>
              <SelectTrigger><SelectValue placeholder="Velg leverandør…" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Supplier SKU</Label>
            <Input value={supplierSku} onChange={(e) => setSupplierSku(e.target.value)} />
          </div>
          <div>
            <Label>Supplier produktnavn</Label>
            <Input value={supplierProductName} onChange={(e) => setSupplierProductName(e.target.value)} />
          </div>
          <div>
            <Label>Avtalt pris</Label>
            <Input value={agreedPrice} onChange={(e) => setAgreedPrice(e.target.value)} placeholder="0,00" />
            <Select value={priceBasis} onValueChange={(v) => setPriceBasis(v === "base" ? "base" : "package")}>
              <SelectTrigger className="mt-2" aria-label="Prisen gjelder"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="package">Per pakning</SelectItem>
                <SelectItem value="base">Per {selectedRm?.base_unit ?? "grunnenhet"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Pakningsstr.</Label>
              <Input value={packageSize} onChange={(e) => setPackageSize(e.target.value)} />
            </div>
            <div>
              <Label>Enhet</Label>
              <Select value={packageUnit} onValueChange={setPackageUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">kg</SelectItem>
                  <SelectItem value="l">l</SelectItem>
                  <SelectItem value="stk">stk</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="col-span-2">
            <Label>Grunnenheter per pakning ({selectedRm?.base_unit ?? "grunnenhet"})</Label>
            <Input
              value={baseUnitsPerPackage}
              onChange={(e) => setBaseUnitsPerPackage(e.target.value)}
              placeholder="F.eks. 25 for en 25 kg sekk"
            />
          </div>
          <div className="col-span-2">
            <Label>
              Pris pr {selectedRm?.base_unit ?? "grunnenhet"}{" "}
              <span className="text-muted-foreground">{pricePerBaseUnitTouched ? "(manuelt overstyrt)" : "(beregnet)"}</span>
            </Label>
            <Input
              value={pricePerBaseUnit}
              onChange={(e) => { setPricePerBaseUnit(e.target.value); setPricePerBaseUnitTouched(true); }}
            />
          </div>
          <div>
            <Label>Gyldig fra</Label>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </div>
          <div>
            <Label>Gyldig til</Label>
            <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Checkbox id="prim" checked={setPrimary} onCheckedChange={(c) => setSetPrimary(!!c)} />
            <Label htmlFor="prim" className="cursor-pointer">Sett som primær leverandør for råvaren</Label>
          </div>
          <div className="col-span-2">
            <Label>Avtaledokument (PDF, valgfri)</Label>
            <Input type="file" accept="application/pdf" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          {pending && (
            <div role="alert" className="space-y-2 text-caption text-destructive sm:mr-auto" data-testid="agreement-unknown">
              <p>
                Utfallet av forrige lagring for denne varen og leverandøren er ukjent — avtalen kan være lagret
                {pending.documentPath ? " (dokumentet ble lastet opp)" : ""}. Kontroller før du lagrer igjen.
              </p>
              {recon === "error" && <p>Kunne ikke lese den lagrede avtalen. Prøv igjen.</p>}
              {recon === "not_observed" && <p>Den lagrede avtalen er ikke lik det som ble sendt. Den forrige lagringen ser ikke ut til å ha gått gjennom, men det er ikke bevist.</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => void reconcile()} disabled={recon === "reading"}>
                  {recon === "reading" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Kontroller lagret avtale
                </Button>
                {recon === "not_observed" && (
                  <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => clearPendingAgreement(pending)}>Lagre som ny endring</Button>
                )}
              </div>
            </div>
          )}
          <Button onClick={submit} disabled={create.isPending || !canWrite || !!pending}>
            {create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Lagre avtale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

class KnownError extends Error {}
class UnknownOutcomeError extends Error {
  constructor(readonly payload: AgreementPayload, readonly documentPath: string | null) { super("ukjent utfall"); }
}

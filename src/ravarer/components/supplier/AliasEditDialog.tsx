import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatDate } from "@/ravarer/lib/constants";
import { useAliasPreview, useEditSupplierAlias } from "@/ravarer/hooks/useSupplierAliasEdit";
import {
  ALIAS_SCOPE_TEXT,
  MATCHABLE_TYPES,
  aliasActions,
  aliasStatusLabel,
  aliasTypeLabel,
  validateAliasDraft,
  type AliasAction,
  type AliasEditFailure,
  type AliasEditResult,
} from "@/ravarer/lib/supplierAliasEdit";

const ACTION_LABEL: Record<AliasAction, string> = { confirm: "Bekreft alias", reject: "Avvis alias", replace: "Rett aliasverdi" };
const ACTION_HELP: Record<AliasAction, string> = {
  confirm: "Aliaset brukes som bekreftet for denne koblingen.",
  reject: "Aliaset blir stående som avvist (negativ læring) med begrunnelse.",
  replace: "Det gamle aliaset beholdes i historikken. Den nye verdien legges inn som «Venter» og må bekreftes separat.",
};

type Props = {
  target: { aliasId: string; rmsId: string; materialName: string | null } | null;
  supplierId: string | undefined;
  onClose: () => void;
  /** Etter bekreftet lagring; ved retting peker `alias` på det nye aliaset. */
  onSaved: (r: AliasEditResult) => void;
};

/**
 * Delt aliasredigerer. Leser alltid serverens forhåndsvisning før handling og sender dens token.
 * Utkast beholdes ved avslag/foreldet tilstand; ukjent utfall krever ny lesing før nytt forsøk.
 */
export function AliasEditDialog({ target, supplierId, onClose, onSaved }: Props) {
  const preview = useAliasPreview(target?.aliasId ?? null, target?.rmsId ?? null);
  const edit = useEditSupplierAlias(supplierId);
  const [action, setAction] = useState<AliasAction | null>(null);
  const [reason, setReason] = useState("");
  const [newValue, setNewValue] = useState("");
  const [failure, setFailure] = useState<AliasEditFailure | null>(null);
  const [needsReread, setNeedsReread] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setAction(null); setReason(""); setNewValue(""); setFailure(null); setNeedsReread(false);
  }, [target?.aliasId, target?.rmsId]);

  const p = preview.data;
  const allowed = p ? aliasActions(p) : new Set<AliasAction>();
  const draftError = action && p ? validateAliasDraft(action, reason, newValue, p.aliasValue) : null;
  const busy = edit.pending;
  /** Bare et vellykket, ferdig hentet forhåndsoppslag kan ligge til grunn for lagring. */
  const previewFresh = preview.isSuccess && !preview.isError && !preview.isFetching;

  const submit = async () => {
    if (!p || !previewFresh || !action || draftError || needsReread || !allowed.has(action)) return;
    const gen = generation.current;
    setFailure(null);
    const r = await edit.submit({ aliasId: p.aliasId, rmsId: p.rmsId, expectedSnapshot: p.expectedSnapshot, action, reason, newValue: action === "replace" ? newValue : null });
    if (gen !== generation.current) return; // annet alias åpnet i mellomtiden
    if (r.ok) { onSaved(r.result); return; }
    if (!r.failure) return;
    setFailure(r.failure);
    if (r.failure.kind === "stale" || r.failure.kind === "unknown") {
      setNeedsReread(r.failure.kind === "unknown");
      void preview.refetch();
    }
  };

  const reread = async () => {
    const res = await preview.refetch();
    if (res.isSuccess) setNeedsReread(false);
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="flex max-h-[calc(100dvh-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:p-0" closeClassName="flex h-[44px] w-[44px] items-center justify-center right-1 top-1">
        <DialogHeader className="shrink-0 border-b border-line-subtle p-4 pr-12 sm:p-6 sm:pr-12">
          <DialogTitle>Rediger alias</DialogTitle>
          <DialogDescription>{ALIAS_SCOPE_TEXT}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {preview.isLoading && <p className="flex items-center gap-2 text-sm text-ink-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Henter aliaset…</p>}
          {preview.isError && (
            <p role="alert" className="text-sm text-destructive">{previewErrorText(preview.error)}</p>
          )}
          {p && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" data-testid="alias-preview">
              <dt className="text-ink-secondary">Verdi</dt><dd className="font-mono [overflow-wrap:anywhere]">{p.aliasValue}</dd>
              <dt className="text-ink-secondary">Type</dt><dd>{aliasTypeLabel(p.aliasType)}</dd>
              <dt className="text-ink-secondary">Status</dt><dd>{aliasStatusLabel(p.status)}{p.rejectedReason ? ` — ${p.rejectedReason}` : ""}</dd>
              <dt className="text-ink-secondary">Råvare</dt><dd>{target?.materialName ?? "Ukjent råvare"}</dd>
              <dt className="text-ink-secondary">Treff</dt>
              <dd>{p.matchCount > 0 ? `${p.matchCount} · sist sett ${formatDate(p.lastSeenAt)}` : "Ingen observerte treff"}</dd>
            </dl>
          )}
          {p && p.status === "superseded" && <p className="text-sm text-ink-secondary">Aliaset er erstattet og vises bare som historikk.</p>}
          {p && !p.canEdit && p.status !== "superseded" && <p className="text-sm text-ink-secondary">Du har lesetilgang, men ikke skrivetilgang til dette aliaset.</p>}
          {p && allowed.size > 0 && (
            <>
              <RadioGroup value={action ?? ""} onValueChange={(v) => setAction(v as AliasAction)} aria-label="Velg handling" className="gap-1">
                {(["confirm", "reject", "replace"] as AliasAction[]).filter((a) => allowed.has(a)).map((a) => (
                  <Label key={a} htmlFor={`alias-${a}`} className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border border-line-subtle p-2 font-normal">
                    <RadioGroupItem id={`alias-${a}`} value={a} className="mt-0.5" />
                    <span><span className="font-medium">{ACTION_LABEL[a]}</span><span className="block text-caption text-ink-secondary">{ACTION_HELP[a]}</span></span>
                  </Label>
                ))}
              </RadioGroup>
              {!MATCHABLE_TYPES.has(p.aliasType) && p.status !== "confirmed" && (
                <p className="text-caption text-ink-secondary">{aliasTypeLabel(p.aliasType)} brukes ikke av fakturamatchingen og kan derfor ikke bekreftes.</p>
              )}
              {action === "replace" && (
                <div className="space-y-1">
                  <Label htmlFor="alias-new">Ny verdi</Label>
                  <Input id="alias-new" value={newValue} maxLength={500} onChange={(e) => setNewValue(e.target.value)} className="h-[44px] md:h-10" />
                </div>
              )}
              {action && (
                <div className="space-y-1">
                  <Label htmlFor="alias-reason">Begrunnelse</Label>
                  <Textarea id="alias-reason" rows={2} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
                </div>
              )}
            </>
          )}
          {failure && <p role="alert" className="text-sm text-destructive" data-testid="alias-failure">{failure.message}</p>}
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t border-line-subtle bg-background p-4 sm:p-4">
          <Button variant="outline" className="min-h-[44px] md:min-h-0" disabled={busy} onClick={onClose}>Lukk</Button>
          {needsReread || preview.isError ? (
            <Button className="min-h-[44px] md:min-h-0" disabled={preview.isFetching} onClick={() => void reread()}>Hent aliaset på nytt</Button>
          ) : (
            <Button className="min-h-[44px] md:min-h-0" disabled={busy || !p || !previewFresh || !action || !!draftError} title={draftError ?? undefined} onClick={() => void submit()}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{action ? ACTION_LABEL[action] : "Velg handling"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function previewErrorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string" && "kind" in e) return e.message;
  return "Kunne ikke hente aliaset.";
}

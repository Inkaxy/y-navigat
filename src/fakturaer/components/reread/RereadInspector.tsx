import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  differingFields, emptySelection, identityChange, REREAD_FIELD_LABEL, REREAD_FIELDS, sameValue, selectionProblem,
  type Candidate, type OldLine, type RereadField, type Selection,
} from "@/fakturaer/lib/reread";
import { IssueList, RawScore, showValue } from "./RereadParts";

type Props = {
  candidate: Candidate;
  lines: OldLine[];
  suggestion: string | null;
  selection: Selection | undefined;
  all: Record<string, Selection>;
  disabled: boolean;
  onChange: (s: Selection) => void;
};

/** Valgt ny linje: gammel/ny per felt, eksplisitt valg av mål, felt og bekreftelser. */
export function RereadInspector({ candidate: c, lines, suggestion, selection, all, disabled, onChange }: Props) {
  const s = selection ?? emptySelection();
  const target = s.target && s.target !== "add" ? lines.find((l) => l.id === s.target) : undefined;
  const compareTo = target ?? lines.find((l) => l.id === suggestion);
  const problem = selectionProblem(c, s, lines, all);
  const diffs = compareTo ? differingFields(c, compareTo) : [];
  const set = (p: Partial<Selection>) => onChange({ ...s, ...p });
  const toggleField = (f: RereadField, on: boolean) => set({ fields: on ? [...s.fields, f] : s.fields.filter((x) => x !== f), confirmed: false });
  const raw = (f: string) => c.evidence.number_evidence.find((e) => e.field === f)?.raw;

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        <h2 className="font-medium">{c.values.description ?? "Uten beskrivelse"}</h2>
      </div>
      <IssueList title="Lesevarsler i ny lesing" issues={c.issues} />

      <div>
        <Label htmlFor="reread-target" className="mb-1 block">Hva gjelder denne linjen?</Label>
        <Select value={s.target ?? "none"} disabled={disabled}
          onValueChange={(v) => onChange({ ...emptySelection(), target: v === "none" ? null : v })}>
          <SelectTrigger id="reread-target"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Ikke valgt – ingenting endres</SelectItem>
            {lines.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                Retter linje {l.line_number ?? "?"}: {l.description ?? "–"}{l.id === suggestion ? " (forslag)" : ""}
              </SelectItem>
            ))}
            <SelectItem value="add">Ny linje som mangler i dag</SelectItem>
          </SelectContent>
        </Select>
        {s.target === null && suggestion && <p className="mt-1 text-caption text-ink-secondary">Foreslått par: linje {lines.find((l) => l.id === suggestion)?.line_number ?? "?"} (likt varenr./navn). Velg den over for å bekrefte.</p>}
      </div>

      {s.target !== "add" && compareTo && (
        <table className="w-full table-fixed text-sm" aria-label="Dagens og ny verdi">
          <thead className="text-caption text-ink-secondary">
            <tr><th className="w-8" /><th className="text-left font-medium">Felt</th><th className="text-left font-medium">Nå</th><th className="text-left font-medium">Ny lesing</th></tr>
          </thead>
          <tbody>
            {REREAD_FIELDS.map((f) => {
              const differs = !sameValue(c.values[f], compareTo[f]);
              return (
                <tr key={f} className="border-t border-border align-top">
                  <td className="py-1">
                    {target && differs && (
                      <Checkbox aria-label={`Ta i bruk ny ${REREAD_FIELD_LABEL[f].toLowerCase()}`} checked={s.fields.includes(f)} disabled={disabled}
                        onCheckedChange={(v) => toggleField(f, v === true)} />
                    )}
                  </td>
                  <td className="py-1 pr-2">{REREAD_FIELD_LABEL[f]}</td>
                  <td className={differs ? "py-1 pr-2 break-words text-ink-secondary" : "py-1 pr-2 break-words"}>{showValue(compareTo[f], f)}</td>
                  <td className={differs ? "py-1 break-words font-medium" : "py-1 break-words text-ink-secondary"}>
                    {showValue(c.values[f], f)}
                    {raw(f) && <span className="block text-caption text-ink-secondary">trykt: «{raw(f)}»</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {compareTo && diffs.length === 0 && s.target !== "add" && <p className="text-ink-secondary">Ny lesing er lik dagens linje. Ingenting å rette.</p>}

      {s.target === "add" && (
        <table className="w-full text-sm" aria-label="Ny linje"><tbody>
          {REREAD_FIELDS.map((f) => <tr key={f} className="border-t border-border"><td className="py-1 pr-2">{REREAD_FIELD_LABEL[f]}</td><td className="py-1 font-medium">{showValue(c.values[f], f)}</td></tr>)}
        </tbody></table>
      )}

      <div className="rounded-md border border-border px-3 py-2 text-caption text-ink-secondary">
        Bare til kontroll (rettes ikke her): EAN {c.evidence.ean ?? "–"} · mva-sats {c.evidence.vat_rate ?? "–"} · rabatt % {c.evidence.discount_pct ?? "–"}.
        Disse feltene kan ikke endres med vanlig linjeretting i dag og krever egen håndtering.
      </div>
      <details className="text-caption text-ink-secondary">
        <summary className="cursor-pointer">Lesedetaljer</summary>
        <p className="mt-1">Leserens egen vurdering, ikke målt korrekthet: <RawScore value={c.evidence.confidence} /></p>
      </details>

      {target && <IssueList title="Lesevarsler på dagens linje (blir stående)" issues={target.issues} />}
      {target && target.issues.length > 0 && <p className="text-caption text-ink-secondary">Gamle varsler lukkes bare ved egen kontroll i «Rett linjer mot originalen».</p>}

      {target?.corrected && s.fields.length > 0 && (
        <div className="space-y-2 rounded-md border border-border px-3 py-2">
          <label className="flex items-start gap-2"><Checkbox checked={s.overrideManual} disabled={disabled} onCheckedChange={(v) => set({ overrideManual: v === true })} />
            <span>Linjen er rettet manuelt før. Overskriv den tidligere rettelsen.</span></label>
          {s.overrideManual && (
            <Textarea aria-label="Hvorfor den tidligere rettelsen skal overskrives" placeholder="Hvorfor er den tidligere rettelsen feil?" value={s.manualReason} disabled={disabled} onChange={(e) => set({ manualReason: e.target.value })} />
          )}
        </div>
      )}
      {target?.manuallyLinked && identityChange(c, s, target) && (
        <label className="flex items-start gap-2 rounded-md border border-border px-3 py-2"><Checkbox checked={s.confirmIdentity} disabled={disabled} onCheckedChange={(v) => set({ confirmIdentity: v === true })} />
          <span>Linjen er koblet til en råvare manuelt. Ny varenr./navn/type fjerner koblingen, og linjen må kobles på nytt.</span></label>
      )}
      {s.target !== null && (s.target === "add" || s.fields.length > 0) && (
        <label className="flex items-start gap-2 rounded-md border border-border px-3 py-2"><Checkbox checked={s.confirmed} disabled={disabled} onCheckedChange={(v) => set({ confirmed: v === true })} />
          <span>{s.target === "add" ? "Jeg har sjekket originalen: linjen mangler i dag og skal legges til." : `Jeg har sjekket originalen: dette er linje ${target?.line_number ?? "?"}.`}</span></label>
      )}
      {problem && <p role="status" className="text-caption text-warning">{problem}</p>}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { ListChecks, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sourceFingerprint } from "@/varer/lib/declarationProposal";
import { readFunctionError } from "@/varer/lib/functionError";
import {
  ALLERGEN_FIELD_LABEL,
  parseAllergenSuggestion,
  planAllergenApply,
  type AllergenApplyPlan,
  type AllergenSuggestion,
} from "@/varer/lib/declarationAllergenSuggestion";

type Invoke = (body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

const defaultInvoke: Invoke = (body) => supabase.functions.invoke("declaration-assistant", { body });

interface Props {
  target: "recipe" | "product";
  targetId: string;
  /** Gjeldende ulagrede ingredienstekst i kladden. */
  value: string;
  canWrite: boolean;
  current: { contains: string; mayContain: string };
  /** Overfører til lokal skjemastate. Bekreftelse ved overskriving håndteres av forelderen. */
  onApply: (plan: AllergenApplyPlan) => void;
  /** Kun for forhåndsvisning/test: erstatt serverkallet med en fixture. */
  invoke?: Invoke;
}

const ERROR_TEXT: Record<string, string> = {
  not_configured: "Deklarasjonsassistenten er ikke satt opp ennå. Fyll inn allergenene manuelt.",
  quota_exceeded: "Dagens grense for AI-kontroller er brukt opp. Prøv igjen i morgen.",
  forbidden: "Du har ikke tilgang til å kjøre AI-hjelpen her.",
  malformed: "Svaret fra AI kunne ikke kontrolleres og ble forkastet. Ingen felter er endret.",
  timeout: "AI-hjelpen tok for lang tid. Ingen felter er endret.",
};

/**
 * «Hent allergener fra deklarasjon»: AI leser teksten i kladden og foreslår
 * allergenfelt med kilde. Ingenting endres før «Bruk allergenforslag», og
 * ingenting lagres før «Lagre kladd».
 */
export function DeclarationAllergenExtractor({ target, targetId, value, canWrite, current, onApply, invoke = defaultInvoke }: Props) {
  const [result, setResult] = useState<AllergenSuggestion | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const currentKey = `${target}:${targetId}:${sourceFingerprint(value)}`;
  const stale = !!result && resultKey !== currentKey;

  // Bytte av oppskrift/vare forkaster svar og kall underveis.
  useEffect(() => {
    requestRef.current += 1;
    setResult(null);
    setResultKey(null);
    setError(null);
    setLoading(false);
    return () => {
      requestRef.current += 1;
    };
  }, [target, targetId]);

  const run = useCallback(async () => {
    const requestId = ++requestRef.current;
    const text = value;
    const keyAtRequest = `${target}:${targetId}:${sourceFingerprint(text)}`;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: fnError } = await invoke({ mode: "allergens", target, id: targetId, draft_text: text });
      if (requestId !== requestRef.current) return;
      if (fnError) {
        const payload = await readFunctionError(fnError, data);
        if (requestId !== requestRef.current) return;
        setError(ERROR_TEXT[payload.code ?? ""] ?? payload.message ?? "AI-hjelpen kunne ikke kjøres akkurat nå. Ingen felter er endret.");
        return;
      }
      const d = data as Record<string, unknown> | null;
      if (d && d.available === false) {
        setError(ERROR_TEXT[String(d.code)] ?? "AI-hjelpen er ikke tilgjengelig. Fyll inn allergenene manuelt.");
        return;
      }
      const parsed = parseAllergenSuggestion(data);
      if (!parsed) {
        setError(ERROR_TEXT.malformed);
        return;
      }
      if (parsed.sourceFingerprint !== sourceFingerprint(text)) {
        setError("Teksten endret seg underveis. Hent allergenene på nytt.");
        return;
      }
      setResult(parsed);
      setResultKey(keyAtRequest);
    } catch {
      if (requestId === requestRef.current) setError("AI-hjelpen kunne ikke kjøres akkurat nå. Ingen felter er endret.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [invoke, target, targetId, value]);

  const plan = result && !stale ? planAllergenApply(current, result) : null;

  return (
    <div className="space-y-3 rounded-md border p-3" aria-label="Allergener fra deklarasjonen">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          AI leser teksten over, også umerkede ord, og foreslår allergenfeltene med kilde.
        </span>
        <Button size="sm" variant="outline" onClick={run} disabled={!canWrite || loading || !value.trim()}>
          {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ListChecks className="mr-1.5 h-4 w-4" />}
          Hent allergener fra deklarasjon
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {stale && (
        <Alert>
          <AlertDescription>Teksten er endret etter at forslaget ble laget. Hent allergenene på nytt.</AlertDescription>
        </Alert>
      )}

      {result && !stale && plan && (
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inneholder</div>
            {result.contains.length ? (
              <ul className="mt-1 space-y-1">
                {result.contains.map((a) => (
                  <li key={a.code} className="flex flex-wrap items-baseline gap-2">
                    <Badge variant="secondary">{a.label}</Badge>
                    <span className="text-xs text-muted-foreground">kilde: «{a.evidence}»</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Fant ingen allergener i teksten. Feltet endres ikke.</p>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kan inneholde spor av</div>
            {!result.traceStatement.stated ? (
              <div className="mt-1 text-xs text-muted-foreground">
                <Badge variant="outline" className="mr-1.5">Ikke oppgitt i deklarasjonen</Badge>
                Det betyr ikke at varen er fri for spor. Feltet endres ikke.
              </div>
            ) : (
              <>
                <p className="mt-1 text-xs text-muted-foreground">Sporsetning: «{result.traceStatement.evidence}»</p>
                <ul className="mt-1 space-y-1">
                  {result.mayContain.map((a) => (
                    <li key={a.code} className="flex flex-wrap items-baseline gap-2">
                      <Badge variant="secondary">{a.label}</Badge>
                      <span className="text-xs text-muted-foreground">kilde: «{a.evidence}»</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {result.uncertainties.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Uavklart — ikke tatt med</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                {result.uncertainties.map((u) => (
                  <li key={u.evidence}>«{u.evidence}»: {u.note}</li>
                ))}
              </ul>
            </div>
          )}

          {result.rejected.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{result.rejected.length} AI-funn ble forkastet</summary>
              <ul className="mt-1 list-disc pl-5">
                {result.rejected.map((r, i) => (
                  <li key={`${r.value}-${i}`}>«{r.value}»: {r.reason}</li>
                ))}
              </ul>
            </details>
          )}

          {plan.changes.length > 0 ? (
            <div className="space-y-1 rounded-md bg-muted/30 p-2 text-xs">
              {plan.changes.map((c) => (
                <div key={c.field}>
                  <b>{ALLERGEN_FIELD_LABEL[c.field]}:</b> {c.before.trim() ? `«${c.before}»` : "tomt"} → «{c.after}»
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Feltene stemmer allerede med forslaget.</p>
          )}

          {canWrite && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Ingenting lagres før du trykker «Lagre kladd».</span>
              <Button size="sm" disabled={plan.changes.length === 0} onClick={() => onApply(plan)}>
                Bruk allergenforslag
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

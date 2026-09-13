import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Check, Info, Loader2, Sparkles, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { MarkedText } from "@/varer/components/label/MarkedText";
import { formatDeclaration, type DeclarationIssue } from "@/varer/lib/declarationFormat";
import { sourceFingerprint } from "@/varer/lib/declarationProposal";

interface AssistantResponse {
  instruction_version: string;
  model: string;
  source_fingerprint: string;
  context_notes: string[];
  metadata_conflicts: { allergen: string; direction: string; message: string }[];
  suggestion: { markerText: string; issues: DeclarationIssue[]; allergenCodes: string[]; blocked: boolean };
  before: { markerText: string; issues: DeclarationIssue[]; allergenCodes: string[]; blocked: boolean };
  accepted: { original: string; suggested: string; reason: string }[];
  rejected: { proposal: { original: string; suggested: string }; reason: string }[];
  blocking: string[];
  findings: { code: string; basis: string; evidence: string; severity: string }[];
  questions: { question: string; severity: string }[];
  quota: { used: number; limit: number };
}

/** Svaret gjengis ALDRI før formen er kontrollert. */
function parseResponse(raw: unknown): AssistantResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : null);
  const suggestion = o.suggestion as Record<string, unknown> | undefined;
  const before = o.before as Record<string, unknown> | undefined;
  const quota = o.quota as Record<string, unknown> | undefined;
  if (
    typeof o.source_fingerprint !== "string" ||
    typeof o.model !== "string" ||
    !suggestion ||
    typeof suggestion.markerText !== "string" ||
    !before ||
    typeof before.markerText !== "string" ||
    !arr(suggestion.issues) ||
    !arr(before.issues) ||
    !arr(o.accepted) ||
    !arr(o.rejected) ||
    !arr(o.blocking) ||
    !arr(o.findings) ||
    !arr(o.questions) ||
    !quota
  ) {
    return null;
  }
  return {
    instruction_version: String(o.instruction_version ?? ""),
    model: o.model,
    source_fingerprint: o.source_fingerprint,
    context_notes: (arr(o.context_notes) ?? []).map((n) => String(n)),
    metadata_conflicts: (arr(o.metadata_conflicts) ?? []) as AssistantResponse["metadata_conflicts"],
    suggestion: {
      markerText: suggestion.markerText,
      issues: suggestion.issues as DeclarationIssue[],
      allergenCodes: (arr(suggestion.allergenCodes) ?? []).map((c) => String(c)),
      blocked: suggestion.blocked === true,
    },
    before: {
      markerText: before.markerText,
      issues: before.issues as DeclarationIssue[],
      allergenCodes: (arr(before.allergenCodes) ?? []).map((c) => String(c)),
      blocked: before.blocked === true,
    },
    accepted: o.accepted as AssistantResponse["accepted"],
    rejected: o.rejected as AssistantResponse["rejected"],
    blocking: (arr(o.blocking) ?? []).map((b) => String(b)),
    findings: o.findings as AssistantResponse["findings"],
    questions: o.questions as AssistantResponse["questions"],
    quota: { used: Number(quota.used ?? 0), limit: Number(quota.limit ?? 0) },
  };
}

const SETTINGS_PATH = "/varer/innstillinger/deklarasjonsassistent";

interface PanelError {
  message: string;
  showSettingsLink?: boolean;
}

/** Kjente feilkoder får en forklaring folk kan handle på. */
function errorFor(code: string | undefined, fallback: string | undefined): PanelError {
  switch (code) {
    case "not_configured":
      return {
        message:
          "Deklarasjonsassistenten er ikke satt opp ennå. Den deterministiske forhåndsvisningen under virker som normalt.",
        showSettingsLink: true,
      };
    case "encryption_missing":
      return {
        message:
          "Serveren mangler krypteringsnøkkelen, så AI-kontrollen er avslått. Forhåndsvisningen virker som normalt.",
        showSettingsLink: true,
      };
    case "bad_model":
      return {
        message: "Modellen i oppsettet er ikke godkjent. En administrator må velge en godkjent modell.",
        showSettingsLink: true,
      };
    case "quota_exceeded":
      return {
        message: fallback ?? "Dagens grense for AI-kontroller er brukt opp. Prøv igjen i morgen.",
        showSettingsLink: true,
      };
    case "forbidden":
      return { message: fallback ?? "Du har ikke tilgang til å kjøre kontrollen her." };
    case "context_too_large":
    case "context_failed":
      return {
        message:
          fallback ??
          "Grunnlaget for kontrollen kunne ikke hentes fullstendig. Ingen kontroll er kjørt.",
      };
    case "timeout":
      return { message: "AI-kontrollen tok for lang tid og ble avbrutt. Ingen endring er gjort." };
    default:
      return { message: fallback ?? "AI-kontrollen kunne ikke kjøres akkurat nå." };
  }
}

interface Props {
  target: "recipe" | "product";
  /** Id-en til oppskriften eller varen teksten hører til. */
  targetId: string;
  /** Gjeldende, ulagrede utkast. */
  value: string;
  canWrite: boolean;
  /** Oppdaterer KUN utkastet — lagrer og godkjenner ingenting. */
  onApply: (markerText: string) => void;
}

/**
 * Deklarasjonshjelp: deterministisk forhåndsvisning hele tiden, og en frivillig
 * AI-kontroll på toppen. AI-en kan aldri lagre, godkjenne eller endre tall.
 */
export function DeclarationAssistantPanel({ target, targetId, value, canWrite, onApply }: Props) {
  const [result, setResult] = useState<AssistantResponse | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PanelError | null>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  const local = useMemo(() => formatDeclaration(value), [value]);
  const currentFingerprint = useMemo(() => sourceFingerprint(value), [value]);
  /** Svaret hører til ÉN tekst på ÉN oppskrift/vare — ikke bare til en tekst. */
  const currentKey = `${target}:${targetId}:${currentFingerprint}`;
  const stale = !!result && resultKey !== currentKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Et svar som kommer etter at panelet er borte skal ikke gjøre noe.
      requestRef.current += 1;
    };
  }, []);

  // Bytter man oppskrift/vare, forkastes både svaret OG et kall som er underveis.
  useEffect(() => {
    requestRef.current += 1;
    setResult(null);
    setResultKey(null);
    setError(null);
    setLoading(false);
  }, [target, targetId]);

  const runCheck = useCallback(async () => {
    const requestId = ++requestRef.current;
    const keyAtRequest = `${target}:${targetId}:${sourceFingerprint(value)}`;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("declaration-assistant", {
        body: { target, id: targetId, draft_text: value },
      });
      if (!mountedRef.current || requestId !== requestRef.current) return;
      const payload = data as { error?: string; code?: string } | null;
      if (fnError) {
        setError(errorFor(payload?.code, payload?.error));
        return;
      }
      const res = parseResponse(data);
      if (!res) {
        setError({ message: "Svaret fra AI-kontrollen kunne ikke leses. Ingen endring er gjort." });
        return;
      }
      if (res.source_fingerprint !== sourceFingerprint(value)) {
        setError({ message: "Teksten endret seg underveis. Kjør kontrollen på nytt." });
        return;
      }
      setResult(res);
      setResultKey(keyAtRequest);
    } catch {
      if (mountedRef.current && requestId === requestRef.current) {
        setError({ message: "AI-kontrollen kunne ikke kjøres akkurat nå." });
      }
    } finally {
      if (mountedRef.current && requestId === requestRef.current) setLoading(false);
    }
  }, [target, targetId, value]);

  const criticalIssues = (result?.suggestion.issues ?? []).filter((i) => i.severity === "critical");
  const criticalFindings = (result?.findings ?? []).filter((f) => f.severity === "critical");
  const criticalQuestions = (result?.questions ?? []).filter((q) => q.severity === "critical");
  const suggestionBlocked =
    result?.suggestion.blocked === true ||
    (result?.suggestion.issues ?? []).some((i) => i.blocksAutoApply);

  const canApply =
    canWrite &&
    !loading &&
    !!result &&
    !stale &&
    result.blocking.length === 0 &&
    criticalIssues.length === 0 &&
    criticalFindings.length === 0 &&
    criticalQuestions.length === 0 &&
    !suggestionBlocked &&
    result.suggestion.markerText.trim() !== value.trim();

  // Uavklarte unntak/terskler (soya, sulfitt) og helfet liste sperrer også
  // den lokale standardformateringen — de kan ikke «løses» av formatering.
  const localBlocked = local.blocked;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <WandSparkles className="h-4 w-4" />
          Deklarasjonshjelp
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onApply(local.markerText)}
              disabled={!value.trim() || localBlocked}
            >
              Bruk standardformat
            </Button>
          )}
          <Button size="sm" onClick={runCheck} disabled={loading || !value.trim() || !canWrite}>
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            Kontroller med AI
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-muted-foreground">Forhåndsvisning (uten AI)</p>
        <p className="rounded border bg-background p-2 text-sm leading-relaxed">
          {value.trim() ? <MarkedText text={local.markerText} /> : <span className="text-muted-foreground">Ingen tekst ennå</span>}
        </p>
      </div>

      <IssueList issues={local.issues} title="Kontrollpunkter i teksten" />

      {localBlocked && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Noe må avklares faglig først (se punktene over). Formatering kan ikke avgjøre det, så teksten
            kan ikke settes inn automatisk før avklaringen er gjort.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="space-y-1">
            <p>{error.message}</p>
            {error.showSettingsLink && (
              <Link to={SETTINGS_PATH} className="underline underline-offset-2">
                Åpne innstillingene for deklarasjonsassistenten
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="space-y-3 border-t pt-3">
          {stale && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Teksten eller varen er endret etter kontrollen. Kjør kontrollen på nytt før du bruker forslaget.
              </AlertDescription>
            </Alert>
          )}

          {result.blocking.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {result.blocking.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {result.context_notes.length > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {result.context_notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div>
            <p className="mb-1 text-xs text-muted-foreground">Forslag</p>
            <p className="rounded border bg-background p-2 text-sm leading-relaxed">
              <MarkedText text={result.suggestion.markerText} />
            </p>
          </div>

          {result.accepted.length > 0 && (
            <div className="text-xs">
              <p className="mb-1 font-medium">Endringer</p>
              <ul className="space-y-0.5">
                {result.accepted.map((a, i) => (
                  <li key={i} className="text-muted-foreground">
                    «{a.original}» → «{a.suggested}» — {a.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.findings.length > 0 && (
            <div className="text-xs">
              <p className="mb-1 font-medium">Allergenfunn</p>
              <ul className="space-y-0.5">
                {result.findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                    <Badge variant="outline" className="shrink-0">
                      {f.basis === "verified" ? "bekreftet mot råvaredata" : "antatt"}
                    </Badge>
                    <span>{f.code}: {f.evidence}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.questions.length > 0 && (
            <div className="text-xs">
              <p className="mb-1 font-medium">Åpne spørsmål</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {result.questions.map((q, i) => <li key={i}>{q.question}</li>)}
              </ul>
            </div>
          )}

          <IssueList issues={result.suggestion.issues} title="Kontrollpunkter i forslaget" />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Brukt i dag: {result.quota.used} av {result.quota.limit}. Forslaget må vurderes faglig — det er
              ingen garanti for at etiketten er lovlig.
            </p>
            <Button size="sm" onClick={() => {
              onApply(result.suggestion.markerText);
              toast.success("Forslaget er lagt inn i utkastet — husk å lagre");
            }} disabled={!canApply}>
              <Check className="mr-1.5 h-4 w-4" /> Bruk forslag
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function IssueList({ issues, title }: { issues: DeclarationIssue[]; title: string }) {
  if (!issues.length) return null;
  return (
    <div className="text-xs">
      <p className="mb-1 font-medium">{title}</p>
      <ul className="space-y-0.5">
        {issues.map((i, idx) => (
          <li key={idx} className="flex items-start gap-1.5 text-muted-foreground">
            {i.severity === "info" ? (
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            )}
            <span>{i.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

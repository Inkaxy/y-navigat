import { useEffect, useMemo, useRef, useState } from "react";
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
  suggestion: { markerText: string; issues: DeclarationIssue[]; allergenCodes: string[] };
  before: { markerText: string; issues: DeclarationIssue[]; allergenCodes: string[] };
  accepted: { original: string; suggested: string; reason: string }[];
  rejected: { proposal: { original: string; suggested: string }; reason: string }[];
  blocking: string[];
  findings: { code: string; basis: string; evidence: string; severity: string }[];
  questions: { question: string; severity: string }[];
  quota: { used: number; limit: number };
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const local = useMemo(() => formatDeclaration(value), [value]);
  const currentFingerprint = useMemo(() => sourceFingerprint(value), [value]);
  const stale = !!result && result.source_fingerprint !== currentFingerprint;

  // Bytter man oppskrift/vare, skal et gammelt svar aldri henge igjen.
  useEffect(() => {
    requestRef.current += 1;
    setResult(null);
    setError(null);
  }, [target, targetId]);

  async function runCheck() {
    const requestId = ++requestRef.current;
    const fingerprintAtRequest = currentFingerprint;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("declaration-assistant", {
        body: { target, id: targetId, draft_text: value },
      });
      if (requestId !== requestRef.current) return; // Avløst av et nyere kall
      if (fnError) {
        const detail = (data as { error?: string } | null)?.error;
        setError(detail ?? "AI-kontrollen kunne ikke kjøres akkurat nå.");
        return;
      }
      const res = data as AssistantResponse;
      if (res.source_fingerprint !== fingerprintAtRequest) {
        setError("Teksten endret seg underveis. Kjør kontrollen på nytt.");
        return;
      }
      setResult(res);
    } catch {
      if (requestId === requestRef.current) setError("AI-kontrollen kunne ikke kjøres akkurat nå.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  const criticalIssues = (result?.suggestion.issues ?? []).filter((i) => i.severity === "critical");
  const canApply =
    canWrite &&
    !!result &&
    !stale &&
    result.blocking.length === 0 &&
    criticalIssues.length === 0 &&
    result.suggestion.markerText.trim() !== value.trim();

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <WandSparkles className="h-4 w-4" />
          Deklarasjonshjelp
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (
            <Button variant="outline" size="sm" onClick={() => onApply(local.markerText)} disabled={!value.trim()}>
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

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="space-y-3 border-t pt-3">
          {stale && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Teksten er endret etter kontrollen. Kjør kontrollen på nytt før du bruker forslaget.
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
                      {f.basis === "verified" ? "bekreftet" : "antatt"}
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

          <div className="flex items-center justify-between gap-2">
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
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            )}
            <span>{i.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

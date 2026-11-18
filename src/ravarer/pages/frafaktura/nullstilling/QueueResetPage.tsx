// Råvarer › Fra faktura › «Nullstill køen» (bestilling 18.11.2026). Forhåndsvisning → én bekreftelse → kjøring i bolker → kvittering.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { paths } from "@/ravarer/lib/paths";
import { useResetStatus } from "@/ravarer/hooks/useQueueReset";
import { PreviewPanel } from "./PreviewPanel";
import { RunPanel } from "./RunPanel";
import { ReceiptPanel } from "./ReceiptPanel";
import { ResetItemsList } from "./ResetItemsList";
import { Section } from "./parts";

export function QueueResetPage({ canApprove, view }: { canApprove: boolean; view: string | null }) {
  const s = useResetStatus();
  const [autoStart, setAutoStart] = useState(false);
  const [fresh, setFresh] = useState(false);
  const back = <Link className="text-body text-primary hover:underline" to={paths.fraFaktura()}>Tilbake til Fra faktura</Link>;

  let body: JSX.Element;
  if (s.cap === null) body = <p className="text-body">Kontrollerer databaseendringen …</p>;
  else if (s.cap === false) body = <p className="text-body">Venter på databasefilen «Nullstill køen» (<code>01_nullstill_koen.sql</code>). Knappen virker når root har kjørt den etter Henriks ja.</p>;
  else if (s.isLoading) body = <p className="text-body">Laster status …</p>;
  else if (s.isError || !s.data) body = <p role="alert" className="text-body text-destructive">Kunne ikke lese status for nullstillingen. <Button size="sm" variant="ghost" onClick={() => void s.refetch()}>Prøv igjen</Button></p>;
  else {
    const st = s.data;
    const run = st.run;
    if (run && (view === "lukket" || view === "duplikater")) return <ResetItemsList runId={run.id} view={view} canApprove={canApprove} />;
    if (run && (run.status === "aktiv" || run.status === "pause")) body = <RunPanel status={st} canApprove={canApprove} autoStart={autoStart} />;
    else if (run && !fresh) body = <ReceiptPanel status={st} canApprove={canApprove} onNewPreview={() => setFresh(true)} />;
    else body = <PreviewPanel canApprove={canApprove} onStarted={() => { setAutoStart(true); setFresh(false); void s.refetch(); }} />;
  }

  return (
    <div className="space-y-4">
      <Section title="Nullstill køen" actions={back}>
        <p className="text-body text-ink-secondary">
          Behandler alt som ligger åpent i Fra faktura etter faste regler, med de samme handlingene som knappene: «ikke vare» (regel 1), «prisen stemmer» ved avvik inntil 20 % (regel 2),
          bekreftet pakning (regel 3), koble eller opprette vare (regel 4). Fakturaer med sumavvik røres ikke (regel 5). Resten avsluttes via «Hold utenfor» og kan åpnes igjen (regel 6).
          Handlingene lagres ikke som eksempler for fakturaleseren.
        </p>
      </Section>
      {body}
    </div>
  );
}

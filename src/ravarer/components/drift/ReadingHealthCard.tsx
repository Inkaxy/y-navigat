// Innstillinger › Fakturalesing › Helse (punkt 5a): siste lesing, lesekø, feil siste døgn per type, AI-nøkkel,
// databaseendringer som er kjørt og hvilke brytere som er på. Bare lesing.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/hooks/useCompany";
import { CAPABILITY_FILE, useCapability, type CapabilityName } from "@/lib/pendingRpc";
import { useReadingDrift } from "@/ravarer/hooks/useReadingDrift";
import { useInvoiceReadingHealth } from "@/ravarer/hooks/useInvoiceReadingHealth";
import { useFraFakturaSettings } from "@/ravarer/hooks/useFraFaktura";
import { useReadingSettings } from "@/ravarer/lib/fakturalesing/readingApi";
import { fmtOsloDateTime } from "@/ravarer/lib/invoiceReadingHealth";
import { loadKeyTestOk } from "@/ravarer/lib/keyTestMarker";

const n = (v: number | null | undefined) => (v == null ? "ukjent" : v.toLocaleString("nb-NO"));
const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-wrap justify-between gap-2 border-t border-line-subtle py-2 first:border-t-0"><dt className="text-ink-secondary">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>
);

function CapRow({ name }: { name: CapabilityName }) {
  const c = useCapability(name);
  return <Row label={CAPABILITY_FILE[name]} value={c == null ? "ukjent" : c ? "kjørt" : "ikke kjørt"} />;
}

export function ReadingHealthCard() {
  const { data: company } = useCompany();
  const drift = useReadingDrift();
  const health = useInvoiceReadingHealth(company?.id ?? null);
  const reading = useReadingSettings(company?.id);
  const ff = useFraFakturaSettings();
  const d = drift.data;
  const keyOk = loadKeyTestOk();
  const keyText = health.data?.state === "failing" ? `feiler: ${health.data.failure.message}` : health.data?.state === "ok" ? "virker (siste lesinger lyktes)" : "ukjent";
  const stall = d?.stall.kind === "stillstand" ? "står stille" : d?.stall.kind === "feilrate" ? `høy feilrate (${d.stall.pct} %)` : d?.stall.kind === "ok" ? "i drift" : "ukjent";
  const s = reading.data?.settings;
  const sw = (on: boolean | undefined) => (on == null ? "ukjent" : on ? "på" : "av");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Helse</CardTitle>
        <CardDescription>Status for fakturalesingen akkurat nå. Ukjent betyr at tallet ikke kunne leses – ikke at det er null.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 text-sm md:grid-cols-2">
        <section aria-label="Lesing">
          <h3 className="mb-1 font-semibold">Lesing</h3>
          <dl>
            <Row label="Status" value={stall} />
            <Row label="Siste ferdige lesing" value={d ? fmtOsloDateTime(d.lastOkAt) : "ukjent"} />
            <Row label="I lesekø" value={n(d?.pending)} />
            <Row label="Lesinger siste døgn" value={n(d?.attempts24h)} />
            <Row label="Feilet siste døgn" value={n(d?.failed24h)} />
            <Row label="AI-nøkkel" value={keyText} />
            {keyOk && <Row label="Nøkkel sist testet" value={fmtOsloDateTime(keyOk)} />}
          </dl>
          {d?.errors && d.errors.length > 0 && (
            <>
              <h4 className="mb-1 mt-3 font-semibold">Feil siste døgn per type</h4>
              <dl>{d.errors.map((e) => <Row key={e.type} label={e.type} value={n(e.count)} />)}</dl>
            </>
          )}
        </section>
        <section aria-label="Brytere og databaseendringer">
          <h3 className="mb-1 font-semibold">Brytere</h3>
          <dl>
            <Row label="Varekatalog som fasit" value={sw(s?.catalog)} />
            <Row label="Leverandørprofil" value={sw(s?.profile)} />
            <Row label="Læring av rettinger" value={sw(s?.learning)} />
            <Row label="Selvkontroll" value={sw(s?.self_check)} />
            <Row label="Prisendringer under grensen føres uten spørsmål" value={ff.data?.pending ? "ikke tilgjengelig" : sw(ff.data?.quietPrices)} />
            <Row label="Pakning fra faktura" value={ff.data?.pending ? "ikke tilgjengelig" : sw(ff.data?.invoicePackage)} />
          </dl>
          <h3 className="mb-1 mt-3 font-semibold">Databaseendringer</h3>
          <dl>{(Object.keys(CAPABILITY_FILE) as CapabilityName[]).map((c) => <CapRow key={c} name={c} />)}</dl>
        </section>
      </CardContent>
    </Card>
  );
}

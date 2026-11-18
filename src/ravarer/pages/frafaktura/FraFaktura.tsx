import { Link, useSearchParams } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { ReadingStallAlert } from "@/ravarer/components/drift/ReadingStallAlert";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { RAVARER_EYEBROW } from "@/ravarer/pages/hub/hubTabs";
import { paths } from "@/ravarer/lib/paths";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { useFraFakturaCounts } from "@/ravarer/hooks/useFraFaktura";
import { parseFraFakturaTab, type FraFakturaTab } from "@/ravarer/lib/fraFaktura/tabs";
import { cn } from "@/lib/utils";
import { NewItemsTab } from "./NewItemsTab";
import { PriceJumpsTab } from "./PriceJumpsTab";
import { UnreadTab } from "./UnreadTab";
import { QueueResetPage } from "./nullstilling/QueueResetPage";

/** Råvarer › Fra faktura (demo D): systemet gjør jobben, du ser bare det som er nytt eller ser feil ut. */
export default function FraFaktura() {
  const [sp, setSp] = useSearchParams();
  const tab = parseFraFakturaTab(sp.get("fane"));
  const grense = Number(sp.get("grense"));
  const localLimit = Number.isFinite(grense) && grense >= 1 && grense <= 1000 ? grense : null;
  const set = (k: string, v: string | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (v == null) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const rights = useInvoiceRights();
  const reset = sp.get("nullstilling") === "1";
  const counts = useFraFakturaCounts(!reset, localLimit);
  const retur = `${paths.fraFaktura()}${sp.toString() ? `?${sp.toString()}` : ""}`;

  const cards: { id: FraFakturaTab; n: number | null; label: string; sub: string }[] = [
    { id: "nye", n: counts.newItems, label: "Nye varer", sub: "Koble, opprett eller avvis" },
    { id: "prishopp", n: counts.priceJumps, label: "Prishopp", sub: `Over grensen på ${counts.limit} %` },
    { id: "ikke-lest", n: counts.unread, label: "Ikke lest", sub: "Fakturaer som feilet" },
  ];

  return (
    <ModulePage eyebrow={RAVARER_EYEBROW} title="Fra faktura til vare" compact
      subtitle="Systemet leser fakturaen, lager varen og fører prisen. Du ser bare på det som er nytt eller ser feil ut."
      actions={rights.canApprove && !reset ? (
        <Link to={paths.fraFaktura({ nullstilling: 1 })} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] px-3 text-body text-ink-secondary hover:bg-muted hover:text-foreground">
          <RotateCcw className="h-4 w-4" aria-hidden />Nullstill køen …
        </Link>
      ) : undefined}>
      {reset ? <div className="px-page pb-8"><QueueResetPage canApprove={rights.canApprove} view={sp.get("vis")} /></div> : (
      <div className="space-y-4 px-page pb-8">
        <ReadingStallAlert />
        <div role="tablist" aria-label="Fra faktura" className="grid gap-2 sm:grid-cols-3">
          {cards.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} aria-controls={`ff-panel-${x.id}`} onClick={() => set("fane", x.id === "nye" ? null : x.id)}
              className={cn("flex min-h-[64px] items-center gap-4 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50",
                tab === x.id ? "border-2 border-foreground" : "border-line-subtle")}>
              <span className="w-10 font-serif text-3xl tabular-nums">{x.n == null ? "–" : x.n.toLocaleString("nb-NO")}</span>
              <span><span className="block text-body font-semibold">{x.label}</span><span className="block text-caption text-ink-secondary">{x.sub}</span></span>
            </button>
          ))}
        </div>
        <div id={`ff-panel-${tab}`} role="tabpanel">
          {tab === "nye" && <NewItemsTab supplier={sp.get("lev")} onSupplier={(id) => set("lev", id)} canWrite={rights.canWrite} retur={retur} />}
          {tab === "prishopp" && <PriceJumpsTab localLimit={localLimit} onLocalLimit={(v) => set("grense", v == null ? null : String(v))} canWrite={rights.canWrite} canApprove={rights.canApprove} retur={retur} />}
          {tab === "ikke-lest" && <UnreadTab canWrite={rights.canWrite} retur={retur} />}
        </div>
      </div>
      )}
    </ModulePage>
  );
}

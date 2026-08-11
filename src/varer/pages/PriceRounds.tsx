import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { osloTodayISO } from "@/lib/osloDate";
import { nNum } from "@/varer/lib/calcFormat";
import { useAppContext } from "@/varer/context/AppContext";
import {
  ROUND_STATUS_META,
  rpcFeilmelding,
  useCreatePriceRound,
  usePriceRounds,
  usePriceRoundSummaries,
} from "@/varer/hooks/usePriceRounds";

function nDato(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("nb-NO");
}

export default function PriceRounds() {
  const navigate = useNavigate();
  const { legalEntityId, user } = useAppContext();
  const roundsQuery = usePriceRounds(legalEntityId);
  const rounds = roundsQuery.data ?? [];
  const summaries = usePriceRoundSummaries(rounds.map((r) => r.id));
  const createRound = useCreatePriceRound();

  const [open, setOpen] = useState(false);
  const [navn, setNavn] = useState("");
  const [dato, setDato] = useState(osloTodayISO());
  const [notat, setNotat] = useState("");

  useEffect(() => {
    if (roundsQuery.error) toast.error("Kunne ikke hente prisrunder");
  }, [roundsQuery.error]);

  const iDag = osloTodayISO();
  const datoUgyldig = dato < iDag;

  const opprett = async () => {
    if (!legalEntityId) return;
    if (!navn.trim()) {
      toast.error("Runden må ha et navn");
      return;
    }
    if (datoUgyldig) {
      toast.error("Ikrafttredelsesdato må være i dag eller senere");
      return;
    }
    try {
      const round = await createRound.mutateAsync({
        legal_entity_id: legalEntityId,
        name: navn.trim(),
        effective_date: dato,
        note: notat.trim() || null,
        created_by: user?.id ?? null,
      });
      setOpen(false);
      setNavn("");
      setNotat("");
      navigate(`/varer/prisrunder/${round.id}`);
    } catch (e) {
      toast.error(rpcFeilmelding(e, "Kunne ikke opprette prisrunden"));
    }
  };

  return (
    <div className="space-y-5 pb-16">
      <AppHeaderBanner
        title="Prisrunder"
        subtitle="Planlegg, godkjenn og publiser prisendringer"
        actions={
          <Button size="sm" className="rounded-full" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Ny prisrunde
          </Button>
        }
      />

      {roundsQuery.isLoading ? (
        <Skeleton className="h-[320px] w-full" />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-medium">Navn</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Ikrafttredelse</th>
                <th className="px-3 py-2 text-right font-medium">Antall varer</th>
                <th className="px-3 py-2 text-left font-medium">Prislister</th>
                <th className="px-3 py-2 text-left font-medium">Opprettet</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => {
                const meta = ROUND_STATUS_META[r.status] ?? {
                  label: r.status,
                  cls: "bg-muted text-muted-foreground",
                };
                const s = summaries.data?.[r.id];
                return (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/varer/prisrunder/${r.id}`)}
                    className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", meta.cls)}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{nDato(r.effective_date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s ? nNum(s.antall, 0) : "0"}
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-muted-foreground">
                      {s?.lister.length ? s.lister.join(", ") : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{nDato(r.created_at)}</td>
                  </tr>
                );
              })}
              {!rounds.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">
                    Ingen prisrunder ennå. Opprett en runde, eller legg varer i en runde fra
                    lønnsomhetsarket.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ny prisrunde</DialogTitle>
            <DialogDescription>
              Runden opprettes som utkast. Ingen priser endres før den publiseres.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="pr-navn">Navn</Label>
              <Input
                id="pr-navn"
                value={navn}
                onChange={(e) => setNavn(e.target.value)}
                placeholder="F.eks. Prisjustering høst 2026"
              />
            </div>
            <div>
              <Label htmlFor="pr-dato">Ikrafttredelsesdato</Label>
              <Input
                id="pr-dato"
                type="date"
                min={iDag}
                value={dato}
                onChange={(e) => setDato(e.target.value)}
              />
              {datoUgyldig && (
                <p className="mt-1 text-xs text-destructive">
                  Datoen må være i dag eller senere.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="pr-notat">Notat</Label>
              <Textarea
                id="pr-notat"
                value={notat}
                onChange={(e) => setNotat(e.target.value)}
                rows={3}
                placeholder="Valgfritt"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Avbryt
            </Button>
            <Button onClick={opprett} disabled={createRound.isPending || datoUgyldig}>
              Opprett runde
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

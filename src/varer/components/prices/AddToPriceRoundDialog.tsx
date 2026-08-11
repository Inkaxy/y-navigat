import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { osloTodayISO } from "@/lib/osloDate";
import { nNum } from "@/varer/lib/calcFormat";
import {
  rpcFeilmelding,
  useAddPriceRoundLines,
  useCreatePriceRound,
  usePriceRounds,
  type AddLineItem,
} from "@/varer/hooks/usePriceRounds";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legalEntityId: string | null;
  userId?: string | null;
  items: AddLineItem[];
  /** Antall valgte varer som mangler ny pris og derfor hoppes over. */
  skipped?: number;
}

export function AddToPriceRoundDialog({
  open,
  onOpenChange,
  legalEntityId,
  userId,
  items,
  skipped = 0,
}: Props) {
  const navigate = useNavigate();
  const roundsQuery = usePriceRounds(legalEntityId);
  const createRound = useCreatePriceRound();
  const addLines = useAddPriceRoundLines();

  const utkast = useMemo(
    () => (roundsQuery.data ?? []).filter((r) => r.status === "utkast"),
    [roundsQuery.data],
  );

  const [valg, setValg] = useState<string>("ny");
  const [navn, setNavn] = useState("");
  const [dato, setDato] = useState(osloTodayISO());

  useEffect(() => {
    if (open) setValg(utkast.length ? utkast[0].id : "ny");
  }, [open, utkast]);

  useEffect(() => {
    if (roundsQuery.error) toast.error("Kunne ikke hente prisrunder");
  }, [roundsQuery.error]);

  const iDag = osloTodayISO();
  const lagre = async () => {
    if (!legalEntityId || !items.length) return;
    try {
      let roundId = valg;
      if (valg === "ny") {
        if (!navn.trim()) {
          toast.error("Runden må ha et navn");
          return;
        }
        if (dato < iDag) {
          toast.error("Ikrafttredelsesdato må være i dag eller senere");
          return;
        }
        const round = await createRound.mutateAsync({
          legal_entity_id: legalEntityId,
          name: navn.trim(),
          effective_date: dato,
          created_by: userId ?? null,
        });
        roundId = round.id;
      }
      const res = await addLines.mutateAsync({ roundId, items });
      toast.success(`${nNum(res?.lines_upserted ?? items.length, 0)} varer lagt i prisrunden`);
      onOpenChange(false);
      navigate(`/varer/prisrunder/${roundId}`);
    } catch (e) {
      toast.error(rpcFeilmelding(e, "Kunne ikke legge varene i prisrunden"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Legg i prisrunde</DialogTitle>
          <DialogDescription>
            {nNum(items.length, 0)} varer legges til som utkast — ingen priser endres nå.
            {skipped > 0 && ` ${nNum(skipped, 0)} valgte varer mangler ny pris og hoppes over.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Prisrunde</Label>
            <Select value={valg} onValueChange={setValg}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {utkast.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
                <SelectItem value="ny">+ Ny prisrunde</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {valg === "ny" && (
            <>
              <div>
                <Label htmlFor="apr-navn">Navn</Label>
                <Input
                  id="apr-navn"
                  value={navn}
                  onChange={(e) => setNavn(e.target.value)}
                  placeholder="F.eks. Prisjustering høst 2026"
                />
              </div>
              <div>
                <Label htmlFor="apr-dato">Ikrafttredelsesdato</Label>
                <Input
                  id="apr-dato"
                  type="date"
                  min={iDag}
                  value={dato}
                  onChange={(e) => setDato(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            onClick={lagre}
            disabled={!items.length || createRound.isPending || addLines.isPending}
          >
            Legg til
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

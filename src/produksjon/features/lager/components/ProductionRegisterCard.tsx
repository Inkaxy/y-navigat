import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BigStepper } from "./BigStepper";
import { useRegisterProduction, type LagerItem } from "../hooks/useLager";
import { showError } from "@/lib/userError";

const nf = new Intl.NumberFormat("nb-NO");

function formatDate(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}.${m}`;
}

export function ProductionRegisterCard({
  items,
  departmentId,
}: {
  items: LagerItem[];
  departmentId: string | null;
}) {
  const register = useRegisterProduction();
  const [itemId, setItemId] = useState("");
  const [count, setCount] = useState(1);
  const [batchNumber, setBatchNumber] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [note, setNote] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (okMsg) {
      toast.success(okMsg);
      setOkMsg(null);
    }
  }, [okMsg]);

  useEffect(() => {
    if (errMsg) {
      toast.error(errMsg);
      setErrMsg(null);
    }
  }, [errMsg]);

  useEffect(() => {
    if (itemId && !items.some((i) => i.id === itemId)) setItemId("");
  }, [items, itemId]);

  const selected = items.find((i) => i.id === itemId) ?? null;
  const perTray = selected?.pieces_per_tray ?? null;
  const pieces = perTray ? count * perTray : count;

  const submit = async () => {
    if (!selected) {
      setErrMsg("Velg lagervare");
      return;
    }
    if (count <= 0) {
      setErrMsg("Antall må være større enn 0");
      return;
    }
    try {
      const res = await register.mutateAsync({
        stock_item_id: selected.id,
        trays: perTray ? count : undefined,
        pieces: perTray ? undefined : count,
        batch_number: batchNumber.trim() || undefined,
        expires_on: expiresOn || undefined,
        department_id: selected.department_id ?? departmentId ?? undefined,
        note: note.trim() || undefined,
      });
      const parts = [`+${nf.format(res.quantity ?? pieces)} ${selected.name} registrert`];
      if (res.batch_number) {
        parts.push(
          `(batch ${res.batch_number}${res.expires_on ? `, utløper ${formatDate(res.expires_on)}` : ""})`,
        );
      }
      setOkMsg(parts.join(" "));
      setCount(1);
      setBatchNumber("");
      setExpiresOn("");
      setNote("");
    } catch (e) {
      showError("ProductionRegisterCard", e, (e as Error).message || "Kunne ikke registrere produksjon.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registrer produksjon</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label>Lagervare</Label>
          <Select value={itemId} onValueChange={setItemId}>
            <SelectTrigger className="h-14 text-base">
              <SelectValue placeholder="Velg lagervare" />
            </SelectTrigger>
            <SelectContent>
              {items.map((i) => (
                <SelectItem key={i.id} value={i.id} className="py-3 text-base">
                  {i.name}
                  {i.department_name ? ` · ${i.department_name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <BigStepper value={count} onChange={setCount} min={0} label={perTray ? "plater" : "emner"} />
          <div className="text-base text-muted-foreground">
            {perTray
              ? `plater á ${nf.format(perTray)} = ${nf.format(pieces)} emner`
              : `${nf.format(pieces)} emner`}
          </div>
        </div>

        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="h-12 px-2">
              <ChevronDown className={`mr-2 h-4 w-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
              Detaljer
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="batchnr">Batchnummer</Label>
                <Input
                  id="batchnr"
                  className="h-12"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  placeholder="Genereres automatisk"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="utlop">Utløpsdato</Label>
                <Input
                  id="utlop"
                  type="date"
                  className="h-12"
                  value={expiresOn}
                  onChange={(e) => setExpiresOn(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notat">Notat</Label>
              <Textarea id="notat" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Button
          className="h-16 w-full bg-success text-success-foreground text-lg hover:bg-success/90"
          onClick={submit}
          disabled={register.isPending || !itemId}
        >
          {register.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
          Lagre
        </Button>
      </CardContent>
    </Card>
  );
}

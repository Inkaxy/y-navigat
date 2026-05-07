import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mail, Handshake } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function NewNegotiationTypeDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();

  const cards = [
    {
      icon: Mail,
      title: "Send forespørsel om tilbud (RFQ)",
      desc: "Send strukturert forespørsel til en eller flere leverandører som svarer via webform.",
      best: "Best for: standard reforhandlinger, konkurrere flere leverandører.",
      onClick: () => {
        onOpenChange(false);
        navigate("/ravarer/forhandlinger/ny");
      },
    },
    {
      icon: Handshake,
      title: "Live forhandling (over bordet)",
      desc: "Før forhandlingen i sanntid med en leverandør tilstede – søk opp varer, se data, fyll inn avtalt pris fortløpende.",
      best: "Best for: fysiske møter, telefonmøter, bredere diskusjon med én leverandør.",
      onClick: () => {
        onOpenChange(false);
        navigate("/ravarer/forhandlinger/live/ny");
      },
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Velg type forhandling</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.title}
                onClick={c.onClick}
                className="group flex flex-col gap-3 rounded-xl border border-line-subtle bg-surface p-5 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <p className="font-semibold leading-tight">{c.title}</p>
                <p className="text-sm text-ink-secondary">{c.desc}</p>
                <p className="mt-auto text-xs text-ink-muted">{c.best}</p>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

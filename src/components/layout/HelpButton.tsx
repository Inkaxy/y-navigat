import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { HelpCircle, Bug, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BugReportButton } from "./BugReportButton";
import { getPageHelp } from "@/lib/pageHelp";

/**
 * Hjelp-knapp i topbaren. Viser en kort forklaring av siden brukeren står på,
 * lenke til hjelpesiden og snarvei til feilrapportering.
 */
export function HelpButton() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const help = getPageHelp(pathname);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Hjelp for denne siden"
          className="h-9 w-9 text-brand-cream hover:bg-brand-cream/10 hover:text-brand-cream"
        >
          <HelpCircle className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{help.title}</DialogTitle>
          <DialogDescription>Kort forklaring av siden du står på.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          {help.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" size="sm" asChild onClick={() => setOpen(false)}>
            <Link to="/hjelp" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Hjelp og støtte
            </Link>
          </Button>
          <BugReportButton
            trigger={
              <Button size="sm" variant="secondary" className="gap-2">
                <Bug className="h-4 w-4" />
                Rapporter feil
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

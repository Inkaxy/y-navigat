import { useState } from "react";
import { Bug } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [submitting, setSubmitting] = useState(false);
  const { data: profile } = useCurrentUser();

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Tittel er påkrevd");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("bug_reports").insert({
      title: title.trim(),
      description: description.trim() || null,
      severity,
      source_app: "nbhub",
      source_url: window.location.href,
      user_agent: navigator.userAgent,
      screen_size: `${window.innerWidth}x${window.innerHeight}`,
      reported_by_user_id: profile?.id ?? null,
      reporter_email: profile?.email ?? null,
      reporter_display_name: profile?.display_name ?? null,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Kunne ikke sende rapport", { description: error.message });
      return;
    }
    toast.success("Takk! Feilen er rapportert.");
    setTitle("");
    setDescription("");
    setSeverity("medium");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="fixed bottom-4 right-4 z-30 gap-2 shadow-elevated bg-card"
        >
          <Bug className="h-4 w-4" />
          <span className="hidden sm:inline">Rapporter feil</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rapporter feil</DialogTitle>
          <DialogDescription>
            Beskriv problemet så detaljert du kan. Vi får automatisk med URL og enhetsinfo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bug-title">Tittel</Label>
            <Input
              id="bug-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Kort beskrivelse"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bug-desc">Beskrivelse</Label>
            <Textarea
              id="bug-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Hva skjedde? Hva forventet du?"
            />
          </div>
          <div className="space-y-2">
            <Label>Alvorlighet</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Lav</SelectItem>
                <SelectItem value="medium">Middels</SelectItem>
                <SelectItem value="high">Høy</SelectItem>
                <SelectItem value="critical">Kritisk</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Avbryt
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Sender…" : "Send rapport"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

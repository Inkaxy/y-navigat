// Brand & layout-innstillinger for et keypad-layout. Skriver theme-jsonb til
// pos_keypad_layouts.theme. Defaults håndteres av parseTheme() ved lesing.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BookmarkPlus, Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_FOOTER_ACTIONS,
  FOOTER_ACTION_CODES,
  parseTheme,
  type FooterAction,
  type FooterActionCode,
  type KioskTheme,
} from "@/kiosk/render/kioskTheme";

const FOOTER_ACTION_PRESETS: Record<FooterActionCode, { label: string; icon: string }> = {
  discount: { label: "Rabatt", icon: "Percent" },
  label_print: { label: "Merket lapp", icon: "Tag" },
  park_order: { label: "Parker ordre", icon: "Pause" },
  clear_order: { label: "Slett ordre", icon: "Trash2" },
  receipt: { label: "Kvittering", icon: "Receipt" },
  customer: { label: "Kunde", icon: "User" },
  pickup_orders: { label: "Henteordre", icon: "ShoppingBag" },
  kakebygger: { label: "Kakebygger", icon: "Cake" },
  open_drawer: { label: "Åpne skuff", icon: "Wallet" },
};

interface ThemePreset {
  id: string;
  name: string;
  description: string | null;
  theme: unknown;
  customer_screen: unknown;
  updated_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layoutId: string;
  legalEntityId: string;
  initialTheme: unknown;
  initialCustomerScreen: unknown;
}

export function ThemeSettingsDialog({ open, onOpenChange, layoutId, initialTheme }: Props) {
  const queryClient = useQueryClient();
  const baseTheme = useMemo(() => parseTheme(initialTheme), [initialTheme]);
  const [theme, setTheme] = useState<KioskTheme>(baseTheme);

  useEffect(() => {
    if (open) setTheme(baseTheme);
  }, [open, baseTheme]);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("pos_keypad_layouts")
        .update({ theme: theme as unknown as never })
        .eq("id", layoutId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_layout", layoutId] });
      toast.success("Brand & layout lagret");
      onOpenChange(false);
    },
    onError: (e) =>
      toast.error("Kunne ikke lagre", { description: e instanceof Error ? e.message : "" }),
  });

  const set = <K extends keyof KioskTheme>(key: K, value: KioskTheme[K]) =>
    setTheme((t) => ({ ...t, [key]: value }));

  const moveAction = (idx: number, delta: -1 | 1) => {
    setTheme((t) => {
      const list = [...t.footerActions];
      const next = idx + delta;
      if (next < 0 || next >= list.length) return t;
      const [item] = list.splice(idx, 1);
      list.splice(next, 0, item);
      return { ...t, footerActions: list };
    });
  };

  const removeAction = (idx: number) => {
    setTheme((t) => ({ ...t, footerActions: t.footerActions.filter((_, i) => i !== idx) }));
  };

  const addAction = (code: FooterActionCode) => {
    const preset = FOOTER_ACTION_PRESETS[code];
    const exists = theme.footerActions.some((a) => a.code === code);
    if (exists) {
      toast.info(`${preset.label} ligger allerede i listen`);
      return;
    }
    const next: FooterAction = { code, label: preset.label, icon: preset.icon };
    setTheme((t) => ({ ...t, footerActions: [...t.footerActions, next] }));
  };

  const resetFooter = () =>
    setTheme((t) => ({ ...t, footerActions: [...DEFAULT_FOOTER_ACTIONS] }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Brand & layout</DialogTitle>
          <DialogDescription>
            Styr hvordan kassen presenterer brand-blokk, dining-valg, kurv og handlings-bar. Lagres
            i layoutens tema (jsonb).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Brand
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="brand-name">Brand-navn</Label>
                <Input
                  id="brand-name"
                  value={theme.brandName ?? ""}
                  onChange={(e) => set("brandName", e.target.value || null)}
                  placeholder="NØTTERØ BAKERI"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brand-tagline">Tagline / årstall</Label>
                <Input
                  id="brand-tagline"
                  value={theme.brandTagline ?? ""}
                  onChange={(e) => set("brandTagline", e.target.value || null)}
                  placeholder="ETAB. 1879"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brand-logo">Logo-URL</Label>
                <Input
                  id="brand-logo"
                  value={theme.brandLogoUrl ?? ""}
                  onChange={(e) => set("brandLogoUrl", e.target.value || null)}
                  placeholder="https://… (PNG/SVG)"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brand-monogram">Monogram / mascot URL</Label>
                <Input
                  id="brand-monogram"
                  value={theme.brandMonogramUrl ?? ""}
                  onChange={(e) => set("brandMonogramUrl", e.target.value || null)}
                  placeholder="Valgfri sekundær mark"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Layout
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Header-stil</Label>
                <Select
                  value={theme.headerStyle}
                  onValueChange={(v) => set("headerStyle", v as KioskTheme["headerStyle"])}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minimal">Minimal (terminal-kode + label)</SelectItem>
                    <SelectItem value="branded_left">Branded venstre (logo + navn)</SelectItem>
                    <SelectItem value="branded_centered">Branded sentrert (logo + monogram)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Dining-plassering</Label>
                <Select
                  value={theme.diningPlacement}
                  onValueChange={(v) => set("diningPlacement", v as KioskTheme["diningPlacement"])}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cart_chip">Liten chip i kurv-header</SelectItem>
                    <SelectItem value="top_hero">Store pills øverst i produktområdet</SelectItem>
                    <SelectItem value="header_pills">I header-baren</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Dining-pill stil</Label>
                <Select
                  value={theme.diningPillStyle}
                  onValueChange={(v) => set("diningPillStyle", v as KioskTheme["diningPillStyle"])}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="soft">Soft (accent-tint på aktiv)</SelectItem>
                    <SelectItem value="outlined">Outlined (border på aktiv)</SelectItem>
                    <SelectItem value="solid">Solid (full accent på aktiv)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Kurv-stil</Label>
                <Select
                  value={theme.cartStyle}
                  onValueChange={(v) => set("cartStyle", v as KioskTheme["cartStyle"])}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compact">Kompakt (navn + qty + sum)</SelectItem>
                    <SelectItem value="rich">Rich (thumbnail + stepper)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {theme.cartStyle === "rich" && (
              <div className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Vis produktbilde</span>
                  <Switch
                    checked={theme.cartShowImages}
                    onCheckedChange={(v) => set("cartShowImages", v)}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Vis +/- stepper</span>
                  <Switch
                    checked={theme.cartShowStepper}
                    onCheckedChange={(v) => set("cartShowStepper", v)}
                  />
                </label>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Footer-stil</Label>
              <Select
                value={theme.footerStyle}
                onValueChange={(v) => set("footerStyle", v as KioskTheme["footerStyle"])}
              >
                <SelectTrigger className="max-w-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pill_grid">Pill grid (jevn fordeling)</SelectItem>
                  <SelectItem value="icon_card">Icon-cards (kort med ikon + label)</SelectItem>
                  <SelectItem value="compact_row">Compact row (smal rad)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Footer-handlinger
              </h3>
              <Button variant="ghost" size="sm" onClick={resetFooter}>
                Tilbakestill til standard
              </Button>
            </div>
            <ul className="space-y-2">
              {theme.footerActions.map((a, idx) => (
                <li
                  key={a.code}
                  className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
                >
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{a.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.code} · ikon: {a.icon}
                      {a.variant === "danger" ? " · danger" : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={idx === 0}
                    onClick={() => moveAction(idx, -1)}
                    aria-label="Flytt opp"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={idx === theme.footerActions.length - 1}
                    onClick={() => moveAction(idx, 1)}
                    aria-label="Flytt ned"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAction(idx)}
                    aria-label="Fjern"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
              {theme.footerActions.length === 0 && (
                <li className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
                  Ingen handlinger valgt. Legg til minst én under.
                </li>
              )}
            </ul>
            <div className="flex flex-wrap gap-2">
              {FOOTER_ACTION_CODES.filter(
                (c) => !theme.footerActions.some((a) => a.code === c),
              ).map((code) => (
                <Button
                  key={code}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addAction(code)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {FOOTER_ACTION_PRESETS[code].label}
                </Button>
              ))}
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Lagrer…" : "Lagre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

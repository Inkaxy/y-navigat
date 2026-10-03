import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

export const RECIPE_SECTIONS = [
  { id: "seksjon-ingredienser", label: "Ingredienser" },
  { id: "seksjon-info", label: "Oppskriftsinfo og vekt" },
  { id: "seksjon-prosess", label: "Prosess" },
  { id: "seksjon-notater", label: "Notater og ferdiggjøring" },
  { id: "seksjon-koblinger", label: "Koblede varer og historikk" },
] as const;
export type RecipeSectionId = (typeof RECIPE_SECTIONS)[number]["id"];

/** Flytter fokus til seksjonsoverskriften og ruller den fram. */
export function goToSection(id: string, root: ParentNode = document): boolean {
  const heading = root.querySelector<HTMLElement>(`#${CSS.escape(id)} [data-section-heading]`);
  if (!heading) return false;
  heading.scrollIntoView({ block: "start", behavior: "smooth" });
  heading.focus({ preventScroll: true });
  return true;
}

/** Seksjon med fokuserbar overskrift — mål for «Gå til». */
export function RecipeSection({ id, title, actions, children }: { id: RecipeSectionId; title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-tittel`} className="scroll-mt-48 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle pb-1.5">
        <h2 id={`${id}-tittel`} data-section-heading tabIndex={-1} className="font-display text-title text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Kompakt «Gå til»-navigasjon, rullbar på mobil. */
export function RecipeSectionNav() {
  return (
    <nav aria-label="Gå til i oppskriften" className="-mx-1 overflow-x-auto">
      <ul className="flex items-center gap-1.5 px-1 py-0.5">
        <li className="shrink-0 text-caption text-muted-foreground">Gå til:</li>
        {RECIPE_SECTIONS.map((s) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              onClick={(e) => {
                if (goToSection(s.id)) e.preventDefault();
              }}
              className="inline-flex rounded-full border border-border bg-background px-3 py-1 text-caption text-foreground transition-colors hover:border-app/50 hover:bg-app/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Sann når elementet ikke er i synsfeltet. */
function useOutOfView(ref: RefObject<HTMLElement>): boolean {
  const [out, setOut] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([entry]) => setOut(!entry.isIntersecting));
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);
  return out;
}

/**
 * Lagreknapp nederst på lange sider. Vises bare når det finnes ulagrede
 * endringer OG toppens lagreknapp er rullet ut av syne — aldri to samtidig.
 */
export function StickySaveBar({
  anchorRef, visible, saving, disabled, onSave,
}: {
  anchorRef: RefObject<HTMLElement>;
  visible: boolean;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  const anchorHidden = useOutOfView(anchorRef);
  if (!visible || !anchorHidden) return null;
  return (
    <div role="region" aria-label="Ulagrede endringer" className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-popover px-4 py-2 text-popover-foreground shadow-lg">
        <span className="text-sm">Du har ulagrede endringer</span>
        <Button size="sm" className="rounded-full" onClick={onSave} disabled={disabled || saving}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          Lagre oppskrift
        </Button>
      </div>
    </div>
  );
}

/** Holder rede på et anker-element for StickySaveBar. */
export function useAnchorRef<T extends HTMLElement>() {
  return useRef<T>(null);
}

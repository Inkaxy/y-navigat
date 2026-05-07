import { Search } from "lucide-react";

interface Props {
  onClick: () => void;
}

export function CommandTrigger({ onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden md:flex min-w-[260px] items-center gap-2 rounded-full border border-brand-cream/15 bg-brand-cream/[0.04] px-3.5 py-1.5 text-left text-brand-cream/70 transition-all hover:bg-brand-cream/[0.08] hover:border-brand-bronze/40 hover:text-brand-cream/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bronze/50"
      style={{ fontFamily: "Inter, sans-serif", fontSize: "13px" }}
    >
      <Search className="h-3.5 w-3.5 opacity-70" />
      <span className="flex-1 truncate">Søk eller skriv kommando</span>
      <kbd
        className="rounded-md border border-brand-cream/15 bg-brand-cream/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-brand-cream/70"
      >
        ⌘K
      </kbd>
    </button>
  );
}

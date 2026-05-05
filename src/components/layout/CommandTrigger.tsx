import { Search } from "lucide-react";

interface Props {
  onClick: () => void;
}

export function CommandTrigger({ onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden md:flex min-w-[280px] items-center gap-2 rounded-full border border-line-subtle bg-surface-sunken px-3.5 py-1.5 text-left text-ink-secondary transition-all hover:bg-bakery-cream hover:border-bakery-wheat/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-app/40"
      style={{ fontFamily: "Inter, sans-serif", fontSize: "13px" }}
    >
      <Search className="h-3.5 w-3.5 opacity-70" />
      <span className="flex-1 truncate">Søk eller skriv kommando</span>
      <kbd
        className="rounded-md border border-line-subtle bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-ink-tertiary"
      >
        ⌘K
      </kbd>
    </button>
  );
}

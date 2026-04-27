import { Search } from "lucide-react";

interface Props {
  onClick: () => void;
}

export function CommandTrigger({ onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-[320px] items-center gap-2 rounded-md border border-white/20 bg-white/[0.12] px-3 py-1.5 text-left transition-colors hover:bg-white/[0.18] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      style={{
        color: "hsl(var(--text-on-accent) / 0.88)",
        fontFamily: "Inter, sans-serif",
        fontSize: "13px",
      }}
    >
      <Search className="h-3.5 w-3.5 opacity-80" />
      <span className="flex-1 truncate">Søk eller skriv kommando</span>
      <kbd
        className="rounded border border-white/30 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium"
        style={{ color: "hsl(var(--text-on-accent) / 0.85)" }}
      >
        ⌘K
      </kbd>
    </button>
  );
}

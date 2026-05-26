export const TEAMS = ["kundeservice", "produksjon", "butikk", "konditor", "admin"] as const;
export type TicketTeam = typeof TEAMS[number];

export const TEAM_LABEL: Record<TicketTeam, string> = {
  kundeservice: "Kundeservice",
  produksjon: "Produksjon",
  butikk: "Butikk",
  konditor: "Konditor",
  admin: "Admin",
};

// Tailwind klasser for chips — bruker semantic accent farger med tints
export const TEAM_CHIP: Record<TicketTeam, string> = {
  kundeservice: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  produksjon: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  butikk: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  konditor: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30",
  admin: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

export function isTicketTeam(v: unknown): v is TicketTeam {
  return typeof v === "string" && (TEAMS as readonly string[]).includes(v);
}

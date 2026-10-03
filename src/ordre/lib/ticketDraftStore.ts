// Svarutkast per sak, holdt i minnet for økten. Gjør at kladden overlever
// bytte av sak i innboksen, fanebytte og navigasjon til ordre og tilbake.
// Lagres ikke i nettleseren eller databasen; en ny innlasting tømmer den.
const drafts = new Map<string, string>();

export function readTicketDraft(ticketId: string): string {
  return drafts.get(ticketId) ?? "";
}

export function writeTicketDraft(ticketId: string, text: string): void {
  if (text.trim()) drafts.set(ticketId, text);
  else drafts.delete(ticketId);
}

export function hasTicketDraft(ticketId: string): boolean {
  return (drafts.get(ticketId) ?? "").trim().length > 0;
}

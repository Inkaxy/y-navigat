/**
 * Returkontekst i flyten Innboks → sak → ordre → samtaler → tilbake.
 *
 * Bare tre måltyper er lov, og hver valideres felt for felt:
 *  - innboks:  /ordre/ticket?queue&q&prio&t
 *  - sak:      /ordre/ticket/<uuid>   (kan bære én innboks-retur)
 *  - ordre:    /ordre/ordrer/<uuid>?tab=samtaler
 * Dybden er fast (maks to nivåer), så adressen vokser aldri per rundtur.
 */
import { resolveInternalPath } from "@/lib/safeInternalPath";
import { TICKET_PRIORITIES } from "@/ordre/lib/ticketFormat";

export const TICKET_RETURN_PARAM = "fra";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUEUE_VALUE = /^[a-z_]{1,30}(:[a-z_]{1,30})?$/;
// eslint-disable-next-line no-control-regex -- kontrolltegn skal fjernes
const CONTROL = /[\u0000-\u001f\u007f]/g;
const MAX_RAW = 1500;

export type ReturnKind = "inbox" | "ticket" | "order";
export interface ReturnTarget {
  kind: ReturnKind;
  href: string;
  label: string;
}

export function isUuid(v: string | null | undefined): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** Bare innboksens egne, gyldige parametre beholdes. */
export function sanitizeInboxSearch(params: URLSearchParams): string {
  const out = new URLSearchParams();
  const queue = params.get("queue");
  if (queue && QUEUE_VALUE.test(queue)) out.set("queue", queue);
  const q = (params.get("q") ?? "").replace(CONTROL, "").slice(0, 200);
  if (q.trim()) out.set("q", q);
  const prio = params.get("prio");
  if (prio && (TICKET_PRIORITIES as string[]).includes(prio)) out.set("prio", prio);
  const t = params.get("t");
  if (isUuid(t)) out.set("t", t);
  const s = out.toString();
  return s ? `?${s}` : "";
}

function parse(raw: string | null | undefined, allowNested: boolean): ReturnTarget | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RAW) return null;
  const resolved = resolveInternalPath(raw);
  if (!resolved) return null;
  const url = new URL(resolved, "https://internal.invalid");
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/ordre/ticket") {
    return {
      kind: "inbox",
      href: `/ordre/ticket${sanitizeInboxSearch(url.searchParams)}`,
      label: "Tilbake til innboksen",
    };
  }
  const ticket = /^\/ordre\/ticket\/([^/]+)$/.exec(path);
  if (ticket && isUuid(ticket[1])) {
    let href = `/ordre/ticket/${ticket[1]}`;
    if (allowNested) {
      const nested = parse(url.searchParams.get(TICKET_RETURN_PARAM), false);
      if (nested?.kind === "inbox") {
        href += `?${TICKET_RETURN_PARAM}=${encodeURIComponent(nested.href)}`;
      }
    }
    return { kind: "ticket", href, label: "Tilbake til saken" };
  }
  const order = /^\/ordre\/ordrer\/([^/]+)$/.exec(path);
  if (order && isUuid(order[1])) {
    const tab = url.searchParams.get("tab") === "samtaler" ? "?tab=samtaler" : "";
    return { kind: "order", href: `/ordre/ordrer/${order[1]}${tab}`, label: "Tilbake til ordren" };
  }
  return null;
}

/** Returmål for full sak: innboks eller ordre. Ellers standard innboks. */
export function ticketBackTarget(raw: string | null | undefined): ReturnTarget {
  const t = parse(raw, false);
  if (t && (t.kind === "inbox" || t.kind === "order")) return t;
  return { kind: "inbox", href: "/ordre/ticket", label: "Tilbake til innboksen" };
}

/** Returmål for ordre som er åpnet fra en sak eller innboksen. Null = ingen. */
export function orderBackTarget(raw: string | null | undefined): ReturnTarget | null {
  const t = parse(raw, true);
  return t && (t.kind === "ticket" || t.kind === "inbox") ? t : null;
}

function withReturn(base: string, from: string | null | undefined, allowNested: boolean): string {
  const target = from ? parse(from, allowNested) : null;
  if (!target) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${TICKET_RETURN_PARAM}=${encodeURIComponent(target.href)}`;
}

/** Lenke til full sak. `from` er innboksen eller en ordre. */
export function ticketHref(ticketId: string, from?: string | null): string {
  const base = `/ordre/ticket/${encodeURIComponent(ticketId)}`;
  const target = from ? parse(from, false) : null;
  if (target?.kind === "ticket") return base;
  return withReturn(base, from, false);
}

/** Lenke til ordre. `from` er en sak (med ev. innboks-retur) eller innboksen. */
export function orderHref(
  orderId: string,
  from?: string | null,
  opts: { tab?: "samtaler" } = {},
): string {
  const base = `/ordre/ordrer/${encodeURIComponent(orderId)}${opts.tab ? `?tab=${opts.tab}` : ""}`;
  const target = from ? parse(from, true) : null;
  if (target?.kind === "order") return base;
  return withReturn(base, from, true);
}

/** Gjeldende sti + søk, klar til bruk som `from`. */
export function currentLocationHref(loc: { pathname: string; search: string }): string {
  return `${loc.pathname}${loc.search}`;
}

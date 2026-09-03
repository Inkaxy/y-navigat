import { Lock, Mail, Send, Forward } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatTicketTime,
  formatTicketRelative,
  ticketInitials,
} from "@/ordre/lib/ticketFormat";

export type ConversationVariant = "incoming" | "external" | "outgoing" | "note";

const ROLE_ICON: Record<ConversationVariant, typeof Mail> = {
  incoming: Mail,
  external: Forward,
  outgoing: Send,
  note: Lock,
};

const SHELL: Record<ConversationVariant, string> = {
  incoming: "border-l-4 border-l-sky-500 bg-[hsl(var(--brand-cream))]",
  external: "border-l-4 border-l-purple-500 bg-[hsl(var(--brand-cream))]",
  outgoing: "border-l-4 border-l-primary bg-primary/5",
  note: "border-l-4 border-l-amber-400 bg-amber-50/70 dark:bg-amber-950/20",
};

const AVATAR: Record<ConversationVariant, string> = {
  incoming: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  external: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  outgoing: "bg-primary/15 text-primary",
  note: "bg-amber-500/20 text-amber-800 dark:text-amber-200",
};

/**
 * Ett innlegg i ticket-tråden. Brukes både på ticket-detaljsiden og på
 * ordredetaljens «Koblede samtaler» slik at designet er identisk.
 */
export default function ConversationItem({
  variant,
  authorName,
  roleLabel,
  subLabel,
  at,
  statusChip,
  children,
  footer,
  className,
}: {
  variant: ConversationVariant;
  /** Fullt navn — aldri e-post når vi kjenner navnet. */
  authorName: string;
  /** «Kunde», «Ekstern», «Nøtterø Bakeri», «Internt notat». */
  roleLabel: string;
  /** F.eks. e-postadresse i mindre, dempet tekst. */
  subLabel?: string | null;
  at: string;
  statusChip?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const Icon = ROLE_ICON[variant];
  const alignRight = variant === "outgoing";

  return (
    <article
      className={cn(
        "rounded-lg border p-4 shadow-sm",
        SHELL[variant],
        alignRight && "md:ml-10",
        !alignRight && variant !== "note" && "md:mr-10",
        className,
      )}
    >
      <header className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            AVATAR[variant],
          )}
          aria-hidden="true"
        >
          {ticketInitials(authorName, subLabel)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold text-foreground">{authorName}</span>
            <span className="inline-flex items-center gap-1 rounded border border-border bg-background/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Icon className="h-3 w-3" aria-hidden="true" />
              {roleLabel}
            </span>
            {statusChip}
          </div>
          {subLabel && (
            <div className="truncate text-xs text-muted-foreground">{subLabel}</div>
          )}
        </div>
        <time
          dateTime={at}
          title={formatTicketRelative(at)}
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
        >
          {formatTicketTime(at)}
        </time>
      </header>

      {variant === "note" && (
        <div className="mb-2 inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
          <Lock className="h-3 w-3" aria-hidden="true" /> Kun synlig internt
        </div>
      )}

      <div className="min-w-0">{children}</div>
      {footer && <div className="mt-3 border-t pt-3">{footer}</div>}
    </article>
  );
}

import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  getTicketAttachmentSignedUrl,
  type TicketAttachment,
} from "@/ordre/hooks/useTickets";

export function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_ATTR: ["style", "onerror", "onclick"],
  });
}

/** cid:-referanser fra HTML (img src="cid:xxx"). */
export function extractCidRefs(html: string | null): string[] {
  if (!html) return [];
  const out = new Set<string>();
  const re = /(?:src|href)\s*=\s*["']cid:([^"'>]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.add(m[1].trim());
  return [...out];
}

function rewriteCidImages(html: string, urlMap: Record<string, string>): string {
  return html.replace(
    /(<(?:img|source)[^>]+?)(src|srcset)\s*=\s*["']cid:([^"'>]+)["']/gi,
    (full, prefix, attr, cid) => {
      const key = String(cid).trim().replace(/^<|>$/g, "");
      const url = urlMap[key] ?? urlMap[`<${key}>`] ?? urlMap[key.replace(/@.*$/, "")];
      return url ? `${prefix}${attr}="${url}"` : full;
    },
  );
}

function useCidUrls(attachments: TicketAttachment[], cidRefs: string[]) {
  const [map, setMap] = useState<Record<string, string>>({});
  const key =
    cidRefs.slice().sort().join(",") + "|" + attachments.map((a) => a.id).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const ref of cidRefs) {
        const bare = ref.replace(/^<|>$/g, "");
        const match = attachments.find((a) => {
          const cid = (a.content_id ?? "").replace(/^<|>$/g, "");
          return cid && (cid === bare || cid === ref);
        });
        if (!match) continue;
        try {
          next[bare] = await getTicketAttachmentSignedUrl(match.id, { inline: true });
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setMap(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

/**
 * Renderer sanitert HTML-e-post med innebygde cid:-bilder løst til signerte URL-er.
 */
export default function EmailBody({
  html,
  fallbackText,
  attachments,
  ticketId,
}: {
  html: string | null;
  fallbackText: string;
  attachments: TicketAttachment[];
  ticketId: string;
}) {
  const cidRefs = useMemo(() => extractCidRefs(html), [html]);
  const cidUrls = useCidUrls(attachments, cidRefs);
  const missing = cidRefs.filter((r) => !cidUrls[r.replace(/^<|>$/g, "")]);
  const [refetching, setRefetching] = useState(false);
  const qc = useQueryClient();

  const rewritten = useMemo(
    () => (html ? rewriteCidImages(html, cidUrls) : null),
    [html, cidUrls],
  );

  const onRefetch = async () => {
    setRefetching(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "ticket-refetch-attachments",
        { body: { ticket_id: ticketId } },
      );
      if (error) throw error;
      const inserted = (data as { inserted?: number } | null)?.inserted ?? 0;
      toast.success(
        inserted > 0 ? `Hentet ${inserted} vedlegg fra Outlook` : "Ingen nye vedlegg funnet",
      );
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
    } catch (e) {
      toast.error("Klarte ikke å hente vedlegg", { description: (e as Error).message });
    } finally {
      setRefetching(false);
    }
  };

  return (
    <>
      {rewritten ? (
        <div
          className="prose prose-sm max-w-none text-sm text-foreground [&_a]:text-primary [&_img]:max-w-full [&_img]:rounded [&_img]:border"
          dangerouslySetInnerHTML={{ __html: rewritten }}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm text-foreground">{fallbackText}</p>
      )}
      {missing.length > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
          <Paperclip className="h-3.5 w-3.5" />
          <span>{missing.length} innebygde bilder ble ikke lastet ned fra e-posten.</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 text-xs"
            onClick={onRefetch}
            disabled={refetching}
          >
            {refetching ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Hent fra Outlook
          </Button>
        </div>
      )}
    </>
  );
}

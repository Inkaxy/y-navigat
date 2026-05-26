// Viser originalemailen som ordren ble laget fra — slik at man kan dokumentere
// hvorfor en ordre ble lagt inn slik den ble.
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { ExternalLink, Mail } from "lucide-react";
import DOMPurify from "dompurify";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type Props = { orderId: string; className?: string };

export function OriginalEmailCard({ orderId, className }: Props) {
  const { data, isLoading } = useQuery({
    enabled: !!orderId,
    queryKey: ["original-email-for-order", orderId],
    queryFn: async () => {
      const { data: tickets } = await supabase
        .from("tickets")
        .select("id, subject, sender_email, sender_name, received_at, body_html, body_text, body_preview")
        .eq("related_order_id", orderId)
        .order("received_at", { ascending: true })
        .limit(1);
      return (tickets ?? [])[0] ?? null;
    },
    staleTime: 60_000,
  });

  if (!isLoading && !data) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          Originaler epost
          {data && (
            <Button asChild size="sm" variant="ghost" className="ml-auto h-7 px-2">
              <Link to={`/ordre/ticket/${data.id}`}>
                <ExternalLink className="h-3 w-3 mr-1" /> Åpne ticket
              </Link>
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : data ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">{data.subject ?? "(uten emne)"}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-[10px]">
                {data.sender_name ?? data.sender_email}
              </Badge>
              <span>· {data.sender_email}</span>
              <span>· {format(new Date(data.received_at), "d. MMM yyyy HH:mm", { locale: nb })}</span>
            </div>
            <div
              className="prose prose-sm dark:prose-invert max-w-none border rounded-md p-3 max-h-[400px] overflow-auto bg-muted/30"
              dangerouslySetInnerHTML={{
                __html: data.body_html
                  ? DOMPurify.sanitize(data.body_html)
                  : `<pre class="whitespace-pre-wrap font-sans text-sm">${
                      (data.body_text ?? data.body_preview ?? "").replace(/[<>&]/g, (c) =>
                        ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))
                    }</pre>`,
              }}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default OriginalEmailCard;

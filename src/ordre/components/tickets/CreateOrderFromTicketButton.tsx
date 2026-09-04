import { useMemo, useState } from "react";
import { ShoppingCart, Loader2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNBCustomers, useCustomerById } from "@/ordre/hooks/useNBCustomers";
import {
  CustomerOrderModal,
  type CustomerOrderInitialValues,
  type TicketAttachmentForOrder,
} from "@/ordre/components/orders/CustomerOrderModal";
import QuickCreateCustomerDialog from "@/ordre/components/tickets/QuickCreateCustomerDialog";
import type { AiSuggestion } from "@/ordre/lib/aiSuggestion";
import type { Ticket, TicketAttachment } from "@/ordre/hooks/useTickets";

interface Props {
  ticket: Ticket;
  /** AI-forslaget er valgfritt — ordre skal alltid kunne opprettes. */
  ai?: AiSuggestion | null;
  attachments?: TicketAttachment[];
  onCreated: () => void;
  /** Full bredde i AI-panelet, kompakt i topplinjen. */
  variant?: "panel" | "compact";
  label?: string;
}

// Standard: bildevedlegg foreslås som spiselig print. Andre filtyper er kun referanse.
function edibleHint(a: TicketAttachment, _ai: AiSuggestion | null): boolean {
  return (a.content_type ?? "").startsWith("image/");
}

function buildInitialValues(
  ticket: Ticket,
  ai: AiSuggestion | null,
  attachments: TicketAttachment[],
): CustomerOrderInitialValues {
  const of = ai?.order_fields ?? {};
  const phone = of.contact_phone ?? null;
  const name =
    ai?.customer_match?.customer_name ??
    ticket.sender_name ??
    ticket.sender_email ??
    "";

  const lines = (ai?.products ?? [])
    .filter((p) => p.product_id)
    .map((p) => ({
      product_id: p.product_id as string,
      quantity: Number(p.quantity) || 1,
    }));

  const fieldConfidence: CustomerOrderInitialValues["fieldConfidence"] = {};
  const fc = ai?.field_confidence ?? {};
  const nameConf = ai?.customer_match?.match_confidence;
  if (typeof nameConf === "number") fieldConfidence.name = nameConf;
  fieldConfidence.email = { label: "fra avsender", tone: "green" };
  fieldConfidence.phone = phone
    ? typeof fc.contact_phone === "number"
      ? fc.contact_phone
      : { label: "fra kunden", tone: "green" }
    : { label: "mangler — spør kunden", tone: "red" };
  if (typeof fc.delivery_date === "number") fieldConfidence.delivery_date = fc.delivery_date;
  if (typeof fc.delivery_time === "number") fieldConfidence.delivery_time = fc.delivery_time;
  if (of.pickup_location_hint) {
    fieldConfidence.distribution = {
      label: `henting ${of.pickup_location_hint}`,
      tone: "green",
    };
  }

  const ticketAttachments: TicketAttachmentForOrder[] = (attachments ?? []).map(
    (a) => ({
      id: a.id,
      file_name: a.file_name,
      content_type: a.content_type,
      size_bytes: a.size_bytes,
      edible_suggested: edibleHint(a, ai),
    }),
  );

  return {
    finalCustomerName: name,
    finalCustomerEmail: ticket.sender_email ?? null,
    finalCustomerPhone: phone,
    deliveryDate: of.delivery_date ?? null,
    deliveryTime: of.delivery_time ?? null,
    distribution: of.pickup_location_hint ? "pickup" : "delivery",
    source: "email",
    sendEmail: true,
    sendSms: false,
    isPaid: false,
    lines,
    fieldConfidence,
    cakeText: of.cake_text ?? null,
    ticketAttachments,
  };
}

export default function CreateOrderFromTicketButton({
  ticket,
  ai,
  attachments,
  onCreated,
  variant = "panel",
  label = "Opprett kundeordre fra e-posten",
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);

  const { data: results, isLoading } = useNBCustomers(search);
  const { data: chosen, isLoading: loadingChosen } = useCustomerById(chosenId);

  const initialValues = useMemo(
    () => buildInitialValues(ticket, ai ?? null, attachments ?? []),
    [ticket, ai, attachments],
  );

  const pick = (id: string) => {
    setChosenId(id);
    setPickerOpen(false);
    setModalOpen(true);
  };

  return (
    <>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          {variant === "compact" ? (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
              <ShoppingCart className="h-3.5 w-3.5" />
              {label}
            </Button>
          ) : (
            <Button size="sm" className="mt-2 w-full gap-1.5">
              <ShoppingCart className="h-3.5 w-3.5" />
              {label}
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-2">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">
            Velg utsalg / kunde
          </div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk kunde…"
              className="h-9 pl-8 text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {isLoading && (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Laster…
              </div>
            )}
            {!isLoading && (results ?? []).length === 0 && (
              <div className="py-2 text-xs text-muted-foreground">Ingen treff.</div>
            )}
            {(results ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c.id)}
                className="flex w-full flex-col items-start rounded border border-transparent px-2 py-1.5 text-left text-xs hover:border-border hover:bg-muted"
              >
                <span className="font-semibold text-foreground">
                  {c.display_name}{" "}
                  <span className="ml-1 font-normal text-muted-foreground">
                    ({c.customer_number})
                  </span>
                </span>
                {c.primary_contact_email && (
                  <span className="text-muted-foreground">
                    {c.primary_contact_email}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="mt-2 border-t pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start gap-1.5 text-xs"
              onClick={() => {
                setPickerOpen(false);
                setNewCustomerOpen(true);
              }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Opprett ny kunde fra e-posten
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <QuickCreateCustomerDialog
        open={newCustomerOpen}
        onOpenChange={setNewCustomerOpen}
        defaultName={ticket.sender_name ?? ticket.sender_email ?? ""}
        defaultEmail={ticket.sender_email ?? ""}
        onCreated={(id) => pick(id)}
      />

      {loadingChosen && modalOpen && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/40">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}

      {modalOpen && chosen && (
        <CustomerOrderModal
          presentation="side-panel"
          open={modalOpen}
          onOpenChange={(v) => {
            setModalOpen(v);
            if (!v) {
              // Trigger a refresh so the ticket-detail page can pick up related_order_id
              onCreated();
            }
          }}
          customer={chosen}
          initialValues={initialValues}
          sourceTicketId={ticket.id}
          sourceTicketNumber={ticket.id.slice(0, 8).toUpperCase()}
          sourceTicketSubject={ticket.subject}
        />
      )}

      {modalOpen && !chosen && !loadingChosen && chosenId && (
        <div className="mt-2 text-xs text-destructive">
          Kunne ikke laste valgt kunde.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setModalOpen(false);
              setChosenId(null);
              toast.error("Prøv å velge kunde på nytt");
            }}
          >
            Prøv igjen
          </button>
        </div>
      )}
    </>
  );
}

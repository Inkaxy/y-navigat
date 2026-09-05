import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, Trash2, AlertTriangle, StickyNote } from "lucide-react";

import { z } from "zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fetchEffectivePrice, type ProductOption } from "@/ordre/hooks/useNBProducts";
import { ProductSearchInput } from "@/ordre/components/orders/ProductSearchInput";
import { countRiskyPriceLines, focusOrderLineField } from "@/ordre/lib/orderLines";
import { ZeroPriceConfirmDialog } from "@/ordre/components/orders/ZeroPriceConfirmDialog";
import { useDeliveryTours, tourMatches, trimSec } from "@/ordre/hooks/useDeliveryTours";
import { CustomerContextPanel } from "@/ordre/components/orders/CustomerContextPanel";
import { evaluateCustomerContext, withCreditOverrideNote } from "@/ordre/lib/customerContext";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import {
  useFinalCustomerSuggestions,
  useCreateCustomerOrder,
  useUpdateCustomerOrder,
  useDeleteCustomerOrder,
  useCustomerOrderDetail,
  type CustomerOrderInput,
  type CustomerOrderLineInput,
} from "@/ordre/hooks/useCustomerOrders";
import type { CustomerOption } from "@/ordre/hooks/useNBCustomers";
import { tomorrow } from "@/ordre/lib/format";
import { usePreviewDeliveryRules } from "@/ordre/hooks/usePreviewDeliveryRules";
import { DeliveryRulesFeedback } from "@/ordre/components/rules/DeliveryRulesFeedback";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { OverrideRuleDialog } from "@/ordre/components/rules/OverrideRuleDialog";
import { useUserAccess } from "@/ordre/hooks/useUserAccess";
import { useAuth } from "@/hooks/useAuth";

import { logAudit } from "@/ordre/lib/audit";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { MerknadDialog } from "@/ordre/components/orders/MerknadDialog";
import { type Merknad, isMerknadEmpty } from "@/ordre/lib/merknad";
import {
  PENDING_CAKE_IMAGE_KEY,
  flushPendingCakeImages,
} from "@/ordre/lib/orderLineCakeImage";

import { useProductLabelProfiles } from "@/produksjon/features/etiketter/hooks/useProductLabelProfiles";
import { useLabelPrintProfiles } from "@/produksjon/features/utskriftsprofiler/hooks/useLabelPrintProfiles";
import { supabase } from "@/integrations/supabase/client";
import {
  createCakeImageFromTicketAttachment,
  findCakeLineForOrder,
} from "@/ordre/lib/cakeImages";
import { osloTodayISO } from "@/lib/osloDate";
import { StockAvailabilityWarning } from "@/ordre/components/orders/StockAvailabilityWarning";


export type FieldConfidenceHint =
  | number
  | { label: string; tone: "green" | "amber" | "red" };

export type TicketAttachmentForOrder = {
  id: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  /** true = forhåndsvelger «spiselig print» i modalen */
  edible_suggested?: boolean;
};

export type CustomerOrderInitialValues = {
  finalCustomerName?: string | null;
  finalCustomerEmail?: string | null;
  finalCustomerPhone?: string | null;
  deliveryDate?: string | null;
  deliveryTime?: string | null; // "HH:mm"
  distribution?: "delivery" | "pickup" | null;
  source?: "phone" | "email" | "in_store" | "manual" | null;
  sendSms?: boolean | null;
  sendEmail?: boolean | null;
  isPaid?: boolean | null;
  lines?: Array<{ product_id: string; quantity: number }> | null;
  /** Tekst som skal på kaken — brukes som tittel på cake_images-raden. */
  cakeText?: string | null;
  /** Vedlegg fra ticket-e-posten som vises i «Vedlegg fra e-posten»-seksjonen. */
  ticketAttachments?: TicketAttachmentForOrder[];
  fieldConfidence?: Partial<
    Record<
      "name" | "email" | "phone" | "delivery_date" | "delivery_time" | "distribution",
      FieldConfidenceHint
    >
  >;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: CustomerOption;
  /** If set, modal opens in edit-mode for this order. */
  orderId?: string | null;
  /** Prefill values for create-mode (e.g. from AI-analyse på ticket). */
  initialValues?: CustomerOrderInitialValues | null;
  /** Ticket-id som ordren opprettes fra — kobles automatisk ved lagring. */
  sourceTicketId?: string | null;
  /** Ticketnummer (T-…) vist under Opphav-feltet. */
  sourceTicketNumber?: string | null;
  /** Emne fra ticket-e-posten — brukes som fallback-tittel på kakebilder. */
  sourceTicketSubject?: string | null;
  /**
   * «side-panel» legger skjemaet i høyre halvdel uten mørkt bakteppe, slik at
   * originalmeldingen i ticketen fortsatt er synlig mens ordren fylles ut.
   */
  presentation?: "modal" | "side-panel";
};

type LineDraft = {
  uid: string;
  /** Id på lagret ordrelinje (kun i redigeringsmodus). */
  id?: string;

  product: ProductOption | null;
  product_display_name?: string;
  product_display_number?: number | null;
  product_unit_of_sale?: string;
  product_mva_rate?: number | null;
  quantity: string;
  unit_price: string;
  /** true når sentralisert prisoppslag faller tilbake til 0 — vises som rød advarsel */
  is_fallback?: boolean;
  /** Prisen fra prismotoren, til sammenligning ved manuell overstyring. */
  effective_price?: number | null;
  /** Settes til 'manual_override' når operatøren skriver inn prisen selv. */
  unit_price_source?: string | null;
  unit_price_source_id?: string | null;
  merknad: Merknad | null;
};

function newLine(): LineDraft {
  return {
    uid: crypto.randomUUID(),
    product: null,
    quantity: "1",
    unit_price: "0",
    is_fallback: false,
    merknad: null,
  };
}

function ConfidenceChip({ hint }: { hint: FieldConfidenceHint | undefined }) {
  if (hint == null) return null;
  let tone: "green" | "amber" | "red";
  let label: string;
  if (typeof hint === "number") {
    tone = hint >= 0.9 ? "green" : hint >= 0.6 ? "amber" : "red";
    label = `AI ${Math.round(hint * 100)}%`;
  } else {
    tone = hint.tone;
    label = hint.label;
  }
  const cls =
    tone === "green"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "amber"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  return (
    <span
      className={`ml-1.5 inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

function TicketAttachmentRow({
  attachment,
  value,
  onChange,
}: {
  attachment: TicketAttachmentForOrder;
  value: "edible_print" | "reference_only";
  onChange: (v: "edible_print" | "reference_only") => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const isImage = (attachment.content_type ?? "").startsWith("image/");

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          "ticket-attachment-signed-url",
          { body: { attachment_id: attachment.id, inline: true } },
        );
        if (error) return;
        const url = (data as { signed_url?: string } | null)?.signed_url ?? null;
        if (!cancelled) setThumbUrl(url);
      } catch {
        /* stille */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment.id, isImage]);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-start">
      <div className="flex-shrink-0">
        {thumbUrl && isImage ? (
          <img
            src={thumbUrl}
            alt={attachment.file_name}
            className="h-24 w-24 rounded-md border object-cover"
          />
        ) : (
          <div className="grid h-24 w-24 place-items-center rounded-md border bg-muted text-xs text-muted-foreground">
            {attachment.file_name.split(".").pop()?.toUpperCase() ?? "FIL"}
          </div>
        )}
        <div className="mt-1 max-w-[6rem] truncate text-[11px] text-muted-foreground">
          {attachment.file_name}
        </div>
      </div>

      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as "edible_print" | "reference_only")}
        className="flex-1 space-y-2"
      >
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <RadioGroupItem
            value="edible_print"
            id={`att-${attachment.id}-print`}
            className="mt-0.5"
          />
          <span>
            <span className="font-semibold">🖨️ Spiselig print</span> — legg i
            Kakebilder-køen for leveringsdatoen
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <RadioGroupItem
            value="reference_only"
            id={`att-${attachment.id}-ref`}
            className="mt-0.5"
          />
          <span>Kun dekorreferanse på ordren</span>
        </label>
      </RadioGroup>
    </div>
  );
}






const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

const NameSchema = z
  .string()
  .trim()
  .min(1, "Navn er påkrevd")
  .max(120, "Navn er for langt");
const EmailSchema = z.string().trim().email("Ugyldig e-post").max(255).optional().or(z.literal(""));
const PhoneSchema = z.string().trim().max(40).optional().or(z.literal(""));

export function CustomerOrderModal({
  open,
  onOpenChange,
  customer,
  orderId,
  initialValues,
  sourceTicketId,
  sourceTicketNumber,
  sourceTicketSubject,
  presentation = "modal",
}: Props) {
  const sidePanel = presentation === "side-panel";
  const isEdit = !!orderId;
  const { data: existing, isLoading: loadingExisting } = useCustomerOrderDetail(orderId ?? null);
  const createMut = useCreateCustomerOrder();
  const updateMut = useUpdateCustomerOrder();
  const deleteMut = useDeleteCustomerOrder();

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [deliveryDate, setDeliveryDate] = useState<string>(tomorrow());
  const [hour, setHour] = useState<string>("--");
  const [minute, setMinute] = useState<string>("00");
  const [tourId, setTourId] = useState<string>("none");
  /** Begrunnelse når kredittstopp overstyres. */
  const [creditOverrideReason, setCreditOverrideReason] = useState<string | null>(null);
  const [distribution, setDistribution] = useState<"delivery" | "pickup">("delivery");
  const [source, setSource] = useState<"phone" | "email" | "in_store" | "manual">("phone");
  const [sendSms, setSendSms] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [isPaid, setIsPaid] = useState(false);

  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [dirty, setDirty] = useState(false);
  /**
   * Skjemaet fylles programmatisk når panelet åpnes. Et urørt skjema skal
   * ikke gi «ulagrede endringer»-dialog, så første oppsett hoppes over.
   */
  const initializedRef = useRef(false);
  const skipNextDirtyRef = useRef(false);
  const [merknadFor, setMerknadFor] = useState<string | null>(null);
  /** 0-pris må bekreftes aktivt før lagring. */
  const [zeroPriceOpen, setZeroPriceOpen] = useState(false);
  const [zeroPriceConfirmed, setZeroPriceConfirmed] = useState(false);
  /** Linjer uten reell pris (0 kr eller fallback) — må bekreftes før lagring. */
  const riskyPriceLines = useMemo(
    () =>
      countRiskyPriceLines(
        lines.map((l) => ({
          hasProduct: !!l.product,
          unit_price: l.unit_price,
          is_fallback: l.is_fallback,
        })),
      ),
    [lines],
  );
  const [pendingSaveReason, setPendingSaveReason] = useState<string | null>(null);

  // Vedlegg fra e-posten (ticket) — brukerens valg per vedlegg
  const [attachmentChoice, setAttachmentChoice] = useState<
    Record<string, "edible_print" | "reference_only">
  >({});




  // Re-init when modal opens (or order loads)
  useEffect(() => {
    if (!open) return;
    if (isEdit && existing) {
      setName(existing.final_customer_name ?? "");
      setEmail(existing.final_customer_email ?? "");
      setPhone(existing.final_customer_phone ?? "");
      setDeliveryDate(existing.delivery_date);
      if (existing.delivery_time) {
        const t = trimSec(existing.delivery_time); // "HH:mm"
        setHour(t.slice(0, 2));
        setMinute(t.slice(3, 5));
      } else {
        setHour("--");
        setMinute("00");
      }
      setTourId(existing.delivery_tour_id ?? "none");
      setDistribution(existing.distribution);
      setSource(
        (["phone", "email", "in_store", "manual"] as const).includes(
          existing.source as "phone" | "email" | "in_store" | "manual",
        )
          ? (existing.source as "phone" | "email" | "in_store" | "manual")
          : "manual",
      );
      setSendSms(existing.send_sms_confirm);
      setSendEmail(existing.send_email_confirm);
      setIsPaid(existing.is_paid);

      setLines(
        existing.lines.length > 0
          ? existing.lines.map((l) => ({
              uid: crypto.randomUUID(),
              id: l.id,

              product_display_name: l.product_display_name,
              product_display_number: l.product_display_number,
              product_unit_of_sale: l.product_unit_of_sale,
              quantity: String(l.quantity),
              unit_price: String(l.unit_price),
              merknad: l.merknad,

              // Synthetic ProductOption-ish for re-submission
              ...({
                product: {
                  id: l.product_id,
                  display_number: l.product_display_number ?? 0,
                  code: "",
                  display_name: l.product_display_name,
                  unit_of_sale: l.product_unit_of_sale,
                  mva_rate: 15,
                  status: "active",
                  is_for_sale: true,
                  is_divisible: false,
                } satisfies ProductOption,
              } as { product: ProductOption }),
            }))
          : [newLine()],
      );
      setDirty(false);
    } else if (!isEdit) {
      const iv = initialValues ?? null;
      setName(iv?.finalCustomerName ?? "");
      setEmail(iv?.finalCustomerEmail ?? "");
      setPhone(iv?.finalCustomerPhone ?? "");
      setDeliveryDate(iv?.deliveryDate ?? tomorrow());
      if (iv?.deliveryTime) {
        const t = iv.deliveryTime.slice(0, 5); // HH:mm
        setHour(t.slice(0, 2));
        // Snap to allowed minutes if AI gives odd value
        const rawMin = t.slice(3, 5);
        setMinute(MINUTES.includes(rawMin) ? rawMin : "00");
      } else {
        setHour("--");
        setMinute("00");
      }
      setTourId("none");
      setDistribution(iv?.distribution ?? "delivery");
      setSource(iv?.source ?? "phone");
      setSendSms(iv?.sendSms ?? false);
      setSendEmail(iv?.sendEmail ?? false);
      setIsPaid(iv?.isPaid ?? false);

      // Standardvalg for vedlegg fra e-posten
      const initialChoice: Record<string, "edible_print" | "reference_only"> = {};
      for (const a of iv?.ticketAttachments ?? []) {
        initialChoice[a.id] = a.edible_suggested === false ? "reference_only" : "edible_print";
      }
      setAttachmentChoice(initialChoice);

      setLines([newLine()]);
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, existing]);

  // Prefill produkter fra initialValues.lines (kun i create-modus, når modal åpnes)
  const initialLinesRef = useRef<string>("");
  useEffect(() => {
    if (!open || isEdit) return;
    const lineSpecs = initialValues?.lines ?? [];
    const key = JSON.stringify(lineSpecs);
    if (key === initialLinesRef.current) return;
    initialLinesRef.current = key;
    if (lineSpecs.length === 0) return;
    let cancelled = false;
    (async () => {
      const ids = Array.from(new Set(lineSpecs.map((l) => l.product_id)));
      const { data } = await supabase
        .from("products")
        .select(
          "id, display_number, code, display_name, unit_of_sale, mva_rate, status, is_for_sale, is_divisible",
        )
        .in("id", ids);
      if (cancelled) return;
      const byId = new Map<string, ProductOption>();
      type ProductRow = {
        id: string;
        display_number: number | string;
        code: string;
        display_name: string;
        unit_of_sale: string;
        mva_rate: number | string | null;
        status: string;
        is_for_sale: boolean;
        is_divisible: boolean | null;
      };
      for (const p of (data ?? []) as unknown as ProductRow[]) {
        byId.set(p.id, {
          id: p.id,
          display_number: Number(p.display_number),
          code: p.code,
          display_name: p.display_name,
          unit_of_sale: p.unit_of_sale,
          mva_rate: Number(p.mva_rate ?? 0),
          status: p.status,
          is_for_sale: p.is_for_sale,
          is_divisible: p.is_divisible ?? false,
        });
      }
      const drafts: LineDraft[] = [];
      for (const spec of lineSpecs) {
        const p = byId.get(spec.product_id);
        if (!p) continue;
        const ep = await fetchEffectivePrice({
          productId: p.id,
          customerId: customer.id,
          date: initialValues?.deliveryDate ?? tomorrow(),
          caller: "customer_order_create",
        }).catch(() => null);
        drafts.push({
          uid: crypto.randomUUID(),
          product: p,
          product_display_name: p.display_name,
          product_display_number: p.display_number,
          product_unit_of_sale: p.unit_of_sale,
          product_mva_rate: p.mva_rate,
          quantity: String(spec.quantity),
          unit_price: ep ? String(ep.price) : "0",
          is_fallback: !ep || ep.is_fallback,
          merknad: null,
        });
      }
      if (cancelled || drafts.length === 0) return;
      skipNextDirtyRef.current = true;
      setLines(drafts);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isEdit, initialValues, customer.id]);

  // Mark dirty on any field change after init
  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      skipNextDirtyRef.current = false;
      return;
    }
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    if (skipNextDirtyRef.current) {
      skipNextDirtyRef.current = false;
      return;
    }
    setDirty(true);
    // intentional shallow listing of dependencies for "dirty" detection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, email, phone, deliveryDate, hour, minute, tourId, distribution, source, sendSms, sendEmail, isPaid, lines]);

  // Ny prisrisiko må bekreftes på nytt.
  useEffect(() => {
    setZeroPriceConfirmed(false);
  }, [riskyPriceLines]);

  const { data: tours } = useDeliveryTours({ activeOnly: true });
  const validTours = useMemo(() => {
    if (!tours) return [];
    if (!deliveryDate) return tours;
    return tours.filter((t) => tourMatches(t, deliveryDate, t.time_from.slice(0, 5)));
  }, [tours, deliveryDate]);

  // Hvilke etikettprofiler tilhører produktene på linjene
  const productIds = useMemo(
    () => Array.from(new Set(lines.map((l) => l.product?.id).filter((x): x is string => !!x))),
    [lines],
  );
  const { data: labelProfileMap } = useProductLabelProfiles(productIds, NB_LEGAL_ENTITY_ID);
  const { data: labelProfiles } = useLabelPrintProfiles(NB_LEGAL_ENTITY_ID);
  const profileById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof labelProfiles>[number]>();
    for (const p of labelProfiles ?? []) m.set(p.id, p);
    return m;
  }, [labelProfiles]);
  function getLineProfile(productId: string | undefined | null) {
    if (!productId) return null;
    const id = labelProfileMap?.[productId];
    if (!id) return null;
    return profileById.get(id) ?? null;
  }

  // Reset tour if it's no longer valid for the chosen date
  useEffect(() => {
    if (tourId === "none") return;
    if (!validTours.some((t) => t.id === tourId)) setTourId("none");
  }, [validTours, tourId]);

  const deliveryTimeStr = hour === "--" ? null : `${hour}:${minute}:00`;

  const today = osloTodayISO();

  // ----- Håndhevelse av leveringsregler (DB-motor) -----
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const hasOrdreWrite = access?.hasOrdreWrite ?? false;
  const rulesPreview = usePreviewDeliveryRules({
    legalEntityId: NB_LEGAL_ENTITY_ID,
    customerId: customer.id,
    deliveryDate,
    deliveryTourId: tourId === "none" ? null : tourId,
    productIds,
    existingOrderId: orderId ?? null,
  });
  const [overrideOpen, setOverrideOpen] = useState(false);
  /** Linjen som venter på begrunnelse for manuelt overstyrt pris. */
  const [priceOverrideUid, setPriceOverrideUid] = useState<string | null>(null);
  const [pendingOverrideReason, setPendingOverrideReason] = useState<string | null>(null);


  function removeLine(uid: string) {
    setLines((prev) => prev.filter((l) => l.uid !== uid));
  }

  async function appendProductLine(p: ProductOption) {
    const ep = await fetchEffectivePrice({
      productId: p.id,
      customerId: customer.id,
      date: deliveryDate,
      caller: isEdit ? "customer_order_update" : "customer_order_create",
    }).catch(() => null);
    const draft: LineDraft = {
      uid: crypto.randomUUID(),
      product: p,
      product_display_name: p.display_name,
      product_display_number: p.display_number,
      product_unit_of_sale: p.unit_of_sale,
      product_mva_rate: p.mva_rate,
      quantity: "1",
      unit_price: ep ? String(ep.price) : "0",
      is_fallback: !ep || ep.is_fallback,
      merknad: null,

    };
    setLines((prev) => {
      const cleaned = prev.filter((l) => l.product);
      return [...cleaned, draft];
    });
    // Tastaturflyt: fokus hopper rett til Antall på den nye linjen.
    focusOrderLineField(draft.uid, "qty");
  }

  /** Enter i Antall bekrefter linjen og sender operatøren tilbake til produktsøket. */
  function handleQtyKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    focusOrderLineField("kundeordre", "search");
  }

  function setLineQty(uid: string, value: string) {
    const cleaned = value.replace(",", ".");
    if (cleaned !== "" && !/^\d*\.?\d*$/.test(cleaned)) return;
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, quantity: cleaned } : l)));
  }

  function setLinePrice(uid: string, value: string) {
    const cleaned = value.replace(",", ".");
    if (cleaned !== "" && !/^\d*\.?\d*$/.test(cleaned)) return;
    setLines((prev) =>
      prev.map((l) => {
        if (l.uid !== uid) return l;
        const isOverride =
          l.effective_price != null && Number(cleaned) !== Number(l.effective_price);
        return {
          ...l,
          unit_price: cleaned,
          unit_price_source: isOverride ? MANUAL_PRICE_SOURCE : l.unit_price_source,
        };
      }),
    );
  }

  /** Ber om begrunnelse når operatøren forlater et prisfelt hun har overstyrt. */
  function handlePriceBlur(uid: string) {
    const line = lines.find((l) => l.uid === uid);
    if (!line || !isManualOverride(line.unit_price_source)) return;
    const existing = (line.merknad as { price_override_reason?: string } | null)
      ?.price_override_reason;
    if (existing) return;
    setPriceOverrideUid(uid);
  }

  const totals = useMemo(() => {
    let qty = 0;
    let sum = 0;
    for (const l of lines) {
      if (!l.product) continue;
      const q = Number(l.quantity) || 0;
      const p = Number(l.unit_price) || 0;
      qty += q;
      sum += q * p;
    }
    return { qty, sum, count: lines.filter((l) => l.product).length };
  }, [lines]);

  const fmtKr = (n: number) =>
    n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function buildInput(overrideReason: string | null = pendingOverrideReason): CustomerOrderInput | null {
    const nameRes = NameSchema.safeParse(name);
    if (!nameRes.success) {
      toast.error(nameRes.error.errors[0].message);
      return null;
    }
    const emailRes = EmailSchema.safeParse(email);
    if (!emailRes.success) {
      toast.error(emailRes.error.errors[0].message);
      return null;
    }
    const phoneRes = PhoneSchema.safeParse(phone);
    if (!phoneRes.success) {
      toast.error(phoneRes.error.errors[0].message);
      return null;
    }
    if (!deliveryDate || deliveryDate < today) {
      toast.error("Leveringsdato kan ikke være i fortiden");
      return null;
    }
    const validLines = lines.filter(
      (l) => l.product && Number(l.quantity) > 0,
    );
    if (validLines.length === 0) {
      toast.error("Legg til minst én linje med produkt og mengde");
      return null;
    }
    const customerContext = evaluateCustomerContext({
      creditHold: customer.credit_hold === true,
      creditHoldReason: customer.credit_hold_reason,
      creditOverrideReason,
      canOverrideCreditHold: hasOrdreWrite,
      status: customer.status,
    });
    if (customerContext.blocked) {
      toast.error(
        hasOrdreWrite
          ? `${customerContext.blockMessage} Begrunn overstyringen i kundekontekst-panelet.`
          : `${customerContext.blockMessage} Kontakt ordrekontoret.`,
      );
      return null;
    }
    if (rulesPreview.blocks.length > 0 && !overrideReason) {
      toast.error(
        `Kan ikke lagre — bryter leveringsregel: ${rulesPreview.blocks[0].message}`,
      );
      return null;
    }


    const inputLines: CustomerOrderLineInput[] = validLines.map((l) => ({
      product_id: l.product!.id,
      product_display_number: l.product!.display_number ?? null,
      product_display_name: l.product!.display_name,
      product_code: l.product!.code,
      product_unit_of_sale: l.product!.unit_of_sale,
      product_mva_rate: l.product!.mva_rate ?? 15,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price) || 0,
      unit_price_source: l.unit_price_source ?? null,
      unit_price_source_id: l.unit_price_source_id ?? null,
      merknad: l.merknad && !isMerknadEmpty(l.merknad) ? l.merknad : null,

    }));

    return {
      customerId: customer.id,
      customerSnapshot: {
        customer_number: customer.customer_number,
        display_name: customer.display_name,
        organization_number: customer.organization_number,
        primary_contact_name: customer.primary_contact_name,
        primary_contact_email: customer.primary_contact_email,
      },
      invoiceRecipientCustomerId: customer.invoice_recipient_customer_id,
      finalCustomerName: nameRes.data,
      finalCustomerEmail: email.trim() || null,
      finalCustomerPhone: phone.trim() || null,
      deliveryDate,
      deliveryTime: deliveryTimeStr,
      deliveryTourId: tourId === "none" ? null : tourId,
      distribution,
      source,
      sendSms,
      sendEmail,
      isPaid,
      // Kundeordre-RPC-en har ikke eget notatfelt — kredittstopp-begrunnelsen
      // følger derfor overstyringsteksten på ordren.
      ruleOverrideReason: creditOverrideReason
        ? withCreditOverrideNote(overrideReason ?? "", creditOverrideReason)
        : overrideReason,
      lines: inputLines,
    };

  }

  async function handleSave(overrideReason: string | null = null, forceZeroPrice = false) {
    const input = buildInput(overrideReason);
    if (!input) return;
    if (!forceZeroPrice && !zeroPriceConfirmed && riskyPriceLines > 0) {
      setPendingSaveReason(overrideReason);
      setZeroPriceOpen(true);
      return;
    }
    setSubmitting(true);
    try {
      let fallbackCount = 0;
      let savedOrderId: string | null = null;
      if (isEdit && orderId) {
        const res = await updateMut.mutateAsync({ orderId, input });
        fallbackCount = res?.has_zero_fallback_lines?.length ?? 0;
        savedOrderId = orderId;
        await logAudit({
          action: "updated",
          entity_type: "order",
          entity_id: orderId,
          entity_display_reference: existing?.order_number,
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          changes: { is_customer_order: true, distribution: input.distribution },
        });
        toast.success("Kundeordre oppdatert");
      } else {
        const row = await createMut.mutateAsync(input);
        fallbackCount = row?.has_zero_fallback_lines?.length ?? 0;
        savedOrderId = row.id;

        await logAudit({
          action: "created",
          entity_type: "order",
          entity_id: row.id,
          entity_display_reference: `${row.order_number} — ${input.finalCustomerName}`,
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          changes: {
            is_customer_order: true,
            distribution: input.distribution,
            line_count: input.lines.length,
          },
        });
        toast.success(`Kundeordre ${row.order_number} opprettet`);

        // Koble ticket → ordre + logg hendelse hvis opprettet fra ticket
        if (sourceTicketId) {
          try {
            const { data: u } = await supabase.auth.getUser();
            const userId = u.user?.id ?? null;
            await supabase
              .from("tickets")
              .update({ related_order_id: row.id } as never)
              .eq("id", sourceTicketId);
            // ticket_order_links vedlikeholdes av trigger på tickets.related_order_id

            await supabase.from("ticket_events").insert({
              ticket_id: sourceTicketId,
              order_id: row.id,
              event_type: "order.created_from_ticket",
              actor_type: "staff",
              actor_user_id: userId,
              actor_label: u.user?.email ?? null,
              summary: `Opprettet ordre ${row.order_number}`,
              payload: { order_id: row.id, order_number: row.order_number } as never,
            } as never);
          } catch (linkErr) {
            console.error("Kunne ikke koble ticket til ordre", linkErr);
            toast.warning("Ordre opprettet, men kunne ikke koble til ticket automatisk");
          }

          // Send valgte «spiselig print»-vedlegg til Kakebilder-køen
          const edibleAttachments = (initialValues?.ticketAttachments ?? []).filter(
            (a) => attachmentChoice[a.id] === "edible_print",
          );
          if (edibleAttachments.length > 0) {
            const cakeTitle =
              (initialValues?.cakeText ?? "").trim() ||
              (sourceTicketSubject ?? "").trim() ||
              `Kakebilde — ${row.order_number}`;
            // Finn kake-ordrelinje + produksjonsavdeling for etikett-nummer-reservasjon
            const cakeLineInfo = await findCakeLineForOrder(row.id).catch(() => null);
            for (const a of edibleAttachments) {
              try {
                await createCakeImageFromTicketAttachment({
                  attachment_id: a.id,
                  file_name: a.file_name,
                  ticket_id: sourceTicketId,
                  order_id: row.id,
                  order_line_id: cakeLineInfo?.order_line_id ?? null,
                  production_department_id: cakeLineInfo?.production_department_id ?? null,
                  require_label_unit: cakeLineInfo?.has_label_product ?? false,
                  delivery_date: input.deliveryDate,
                  title: cakeTitle,
                  customer_name: input.finalCustomerName,
                  order_ref: row.order_number,
                });
              } catch (cakeErr) {
                console.error("Kunne ikke sende vedlegg til Kakebilder", cakeErr);
                toast.warning(
                  `Vedlegget «${a.file_name}» kunne ikke legges i Kakebilder-køen`,
                );
              }
            }
            toast.success(
              `${edibleAttachments.length} kakebilde${
                edibleAttachments.length === 1 ? "" : "r"
              } lagt i Kakebilder-køen for ${input.deliveryDate}`,
            );
          }
        }
      }
      if (fallbackCount > 0) {
        toast.warning(
          `${fallbackCount} linje(r) fikk pris 0 — mangler prisliste-rad eller spesialpris`,
        );
      }

      // Kakebilder lastet opp i etikett-dialogen før linjene hadde id:
      // koble dem til de nå lagrede ordrelinjene.
      const hasPending = lines.some(
        (l) =>
          typeof (l.merknad as Record<string, unknown> | null)?.[
            PENDING_CAKE_IMAGE_KEY
          ] === "string",
      );
      if (savedOrderId && hasPending) {
        const { ok, failed } = await flushPendingCakeImages(savedOrderId);
        if (ok > 0) {
          toast.success(
            `Kakebildet er lagt i utskriftskøen for ${input.deliveryDate}`,
            {
              action: {
                label: "Åpne Kakebilder",
                onClick: () => window.open("/ordre/kakebilder", "_blank"),
              },
            },
          );
        }
        if (failed > 0) {
          toast.error("Ordren er lagret, men kakebildet ble ikke lagt i køen", {
            description: "Prøv på nytt fra ordredetaljene.",
          });
        }
      }

      setDirty(false);
      onOpenChange(false);

    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!orderId) return;
    try {
      await deleteMut.mutateAsync(orderId);
      await logAudit({
        action: "deleted",
        entity_type: "order",
        entity_id: orderId,
        entity_display_reference: existing?.order_number,
        legal_entity_id: NB_LEGAL_ENTITY_ID,
      });
      toast.success("Kundeordre slettet");
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke slette");
    }
  }

  function handleClose() {
    unsavedGuard.requestAction(() => onOpenChange(false));
  }

  /** Ulagret-vakt: samme dialog som resten av ordre-modulen. */
  const unsavedGuard = useUnsavedChangesGuard(dirty && open);

  const canDelete = isEdit && !existing?.picked_up_at;
  const deleteTooltip = existing?.picked_up_at
    ? "Ordre er hentet og kan ikke slettes"
    : "";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) handleClose();
          else onOpenChange(true);
        }}
      >
        <DialogContent
          overlayClassName={sidePanel ? "bg-foreground/20" : undefined}
          className={
            sidePanel
              ? "left-auto right-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-[min(46rem,60vw)] translate-x-0 translate-y-0 overflow-y-auto rounded-none border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right max-sm:!max-w-none max-sm:p-4"
              : "max-w-4xl max-h-[92vh] overflow-y-auto max-sm:!left-0 max-sm:!top-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-screen max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:p-4"
          }
        >
          <DialogHeader>
            <DialogTitle>
              {isEdit ? `Rediger kundeordre ${existing?.order_number ?? ""}` : "Ny kundeordre"}
            </DialogTitle>
            <DialogDescription>
              {customer.display_name} ({customer.customer_number})
              {sourceTicketId && !isEdit && (
                <>
                  {" · "}
                  <span className="text-primary">
                    forhåndsutfylt fra samtale {sourceTicketNumber ?? sourceTicketId.slice(0, 8)}
                  </span>{" "}
                  — kontroller og juster fritt
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <CustomerContextPanel
            customer={customer}
            deliveryDate={deliveryDate || null}
            tourId={tourId === "none" ? null : tourId}
            canOverrideCreditHold={hasOrdreWrite}
            creditOverrideReason={creditOverrideReason}
            onCreditOverrideChange={setCreditOverrideReason}
            className="mt-2"
          />

          {isEdit && loadingExisting ? (
            <div className="grid place-items-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Sluttkunde */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Sluttkunde</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <NameField
                    customerId={customer.id}
                    value={name}
                    onChange={setName}
                    onPickSuggestion={(s) => {
                      setName(s.name);
                      if (s.email) setEmail(s.email);
                      if (s.phone) setPhone(s.phone);
                    }}
                    labelSuffix={<ConfidenceChip hint={initialValues?.fieldConfidence?.name} />}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="cf-email">
                      E-post
                      <ConfidenceChip hint={initialValues?.fieldConfidence?.email} />
                    </Label>
                    <Input
                      id="cf-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="navn@eksempel.no"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="cf-phone">
                      Telefon
                      <ConfidenceChip hint={initialValues?.fieldConfidence?.phone} />
                    </Label>
                    <Input
                      id="cf-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="999 99 999"
                    />
                  </div>
                </div>
              </fieldset>

              {/* Leveranse */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Leveranse</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cf-date">
                      Leveringsdato
                      <ConfidenceChip hint={initialValues?.fieldConfidence?.delivery_date} />
                    </Label>
                    <Input
                      id="cf-date"
                      type="date"
                      value={deliveryDate}
                      min={today}
                      onChange={(e) => setDeliveryDate(e.target.value)}
                      lang="nb-NO"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Tid (valgfri)
                      <ConfidenceChip hint={initialValues?.fieldConfidence?.delivery_time} />
                    </Label>
                    <div className="flex items-center gap-2">
                      <Select value={hour} onValueChange={setHour}>
                        <SelectTrigger className="w-24">
                          <SelectValue placeholder="--" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="--">—</SelectItem>
                          {HOURS.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground">:</span>
                      <Select value={minute} onValueChange={setMinute} disabled={hour === "--"}>
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MINUTES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tur</Label>
                    <Select value={tourId} onValueChange={setTourId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Velg tur..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Ingen tur</SelectItem>
                        {validTours.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            #{t.tour_number} — {t.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Distribusjon
                      <ConfidenceChip hint={initialValues?.fieldConfidence?.distribution} />
                    </Label>
                    <RadioGroup
                      value={distribution}
                      onValueChange={(v) => setDistribution(v as "delivery" | "pickup")}
                      className="flex gap-4 pt-2"
                    >
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <RadioGroupItem value="delivery" id="dist-delivery" />
                        Leveres
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <RadioGroupItem value="pickup" id="dist-pickup" />
                        Hentes
                      </label>
                    </RadioGroup>
                  </div>
                </div>
              </fieldset>

              {/* Ordrelinjer */}
              <fieldset className="space-y-3">
                <div className="flex items-center justify-between">
                  <legend className="text-sm font-semibold">Ordrelinjer</legend>
                  <span className="text-xs text-muted-foreground">
                    {totals.count} {totals.count === 1 ? "linje" : "linjer"}
                  </span>
                </div>

                {/* Add via inline search — always available */}
                <ProductSearchInput
                  onSelect={appendProductLine}
                  priceListId={customer.default_price_list_id}
                  focusKey="kundeordre"
                  label="Ny ordrelinje"
                  scope="ordre:kundeordre:produktsok"
                />


                {/* Column header */}
                {lines.some((l) => l.product) && (
                  <div className="grid grid-cols-[1fr_88px_120px_120px_36px_36px] gap-2 px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <span>Produkt</span>
                    <span className="text-right">Antall</span>
                    <span className="text-right">Pris (kr)</span>
                    <span className="text-right">Sum</span>
                    <span />
                    <span />
                  </div>
                )}


                <div className="space-y-1.5">
                  {lines
                    .filter((l) => l.product)
                    .map((l) => {
                      const q = Number(l.quantity) || 0;
                      const p = Number(l.unit_price) || 0;
                      const lineSum = q * p;
                      const hasMerknad = !!l.merknad && !isMerknadEmpty(l.merknad);
                      const lineProfile = getLineProfile(l.product?.id);
                      return (
                        <div
                          key={l.uid}
                          className={`grid grid-cols-[1fr_88px_120px_120px_36px_36px] items-center gap-2 rounded-md border bg-card px-2 py-1.5 transition-colors hover:bg-muted/40 ${

                            l.is_fallback
                              ? "border-destructive ring-1 ring-destructive/40"
                              : "border-border"
                          }`}
                          title={
                            l.is_fallback
                              ? "Pris ikke funnet — mangler prisliste-rad eller spesialpris"
                              : undefined
                          }
                        >
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0 rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                                {l.product!.display_number ?? "—"}
                              </span>
                              <span className="truncate text-sm font-medium">
                                {l.product!.display_name}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {l.product!.unit_of_sale}
                              </span>
                              {l.is_fallback && (
                                <span className="shrink-0 text-xs font-medium text-destructive">
                                  · pris mangler
                                </span>
                              )}
                            </div>
                            <StockAvailabilityWarning productId={l.product!.id} quantity={q} className="mt-0.5" />
                          </div>
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={l.quantity}
                            data-order-line-qty={l.uid}
                            onChange={(e) => setLineQty(l.uid, e.target.value)}
                            onKeyDown={handleQtyKeyDown}
                            aria-label={`Antall for ${l.product!.display_name}`}
                            className="h-9 text-right tabular-nums"
                          />
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={l.unit_price}
                            onChange={(e) => setLinePrice(l.uid, e.target.value)}
                            onBlur={() => handlePriceBlur(l.uid)}
                            className="h-9 text-right tabular-nums"
                          />
                          <div className="text-right text-sm font-medium tabular-nums">
                            {fmtKr(lineSum)}
                          </div>
                          {lineProfile ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setMerknadFor(l.uid)}
                              aria-label={hasMerknad ? "Rediger etikett-felter" : "Legg til etikett-felter"}
                              title={hasMerknad ? "Etikett-felter (utfylt)" : `Etikett-felter (${lineProfile.name})`}
                              className={`h-8 w-8 ${hasMerknad ? "text-primary" : ""}`}
                            >
                              <StickyNote className="h-4 w-4" />
                            </Button>
                          ) : (
                            <span className="h-8 w-8" aria-hidden />
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeLine(l.uid)}
                            aria-label="Fjern linje"
                            className="h-8 w-8"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>

                        </div>
                      );
                    })}

                  {totals.count === 0 && (
                    <div className="rounded-md border border-dashed border-border bg-background py-6 text-center text-sm text-muted-foreground">
                      Ingen linjer ennå — søk opp et produkt over for å legge til.
                    </div>
                  )}
                </div>

                {/* Totals */}
                {totals.count > 0 && (
                  <div className="grid grid-cols-[1fr_88px_120px_120px_36px_36px] items-center gap-2 border-t border-border px-2 pt-2 text-sm">
                    <span className="text-right font-medium text-muted-foreground">
                      Totalt
                    </span>
                    <span className="text-right tabular-nums text-muted-foreground">
                      {totals.qty.toLocaleString("nb-NO")}
                    </span>
                    <span />
                    <span className="text-right font-semibold tabular-nums">
                      {fmtKr(totals.sum)} kr
                    </span>
                    <span />
                    <span />

                  </div>
                )}
              </fieldset>

              {/* Vedlegg fra e-posten (kun ved opprettelse fra ticket) */}
              {!isEdit && (initialValues?.ticketAttachments ?? []).length > 0 && (
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold">Vedlegg fra e-posten</legend>
                  <div className="space-y-3">
                    {(initialValues?.ticketAttachments ?? []).map((a) => (
                      <TicketAttachmentRow
                        key={a.id}
                        attachment={a}
                        value={attachmentChoice[a.id] ?? "reference_only"}
                        onChange={(v) =>
                          setAttachmentChoice((prev) => ({ ...prev, [a.id]: v }))
                        }
                      />
                    ))}
                  </div>
                </fieldset>
              )}

              {/* Opphav */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Opphav</legend>
                <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
                  <SelectTrigger className="sm:w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">Telefon</SelectItem>
                    <SelectItem value="email">E-post</SelectItem>
                    <SelectItem value="in_store">I butikk</SelectItem>
                    <SelectItem value="manual">Manuelt</SelectItem>
                  </SelectContent>
                </Select>
                {sourceTicketId && (
                  <p className="text-xs text-muted-foreground">
                    Settes automatisk til <strong>E-post</strong> · koblet til ticket{" "}
                    <strong>{sourceTicketNumber ?? sourceTicketId.slice(0, 8)}</strong>
                  </p>
                )}
              </fieldset>

              {/* Bekreftelse */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Bekreftelse</legend>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={sendSms}
                      onCheckedChange={(v) => setSendSms(v === true)}
                    />
                    Send SMS-bekreftelse
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={sendEmail}
                      onCheckedChange={(v) => setSendEmail(v === true)}
                    />
                    Send e-post-bekreftelse
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Notifikasjoner sendes ikke ennå — kommer i senere fase.
                  </p>
                </div>
              </fieldset>

              {/* Betaling */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Betaling</legend>
                <RadioGroup
                  value={isPaid ? "yes" : "no"}
                  onValueChange={(v) => setIsPaid(v === "yes")}
                  className="flex gap-4"
                >
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <RadioGroupItem value="no" id="is-paid-no" />
                    Nei
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <RadioGroupItem value="yes" id="is-paid-yes" />
                    Ja
                  </label>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                  Vises på etiketter når feltet «Er betalt» er aktivert på utskriftsprofilen.
                </p>
              </fieldset>

            </div>
          )}

          <DeliveryRulesFeedback
            blocks={rulesPreview.blocks}
            warns={rulesPreview.warns}
            infos={rulesPreview.infos}
            blockedHint={
              rulesPreview.blocks.length > 0 && !hasOrdreWrite
                ? "Ordren kan ikke lagres. Kontakt ordrekontoret hvis den likevel må gjennom."
                : undefined
            }
          />

          <DialogFooter className="gap-2 sm:gap-2">
            {isEdit && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={!canDelete || submitting}
                title={deleteTooltip}
                className="sm:mr-auto"
              >
                <Trash2 className="h-4 w-4" />
                Slett
              </Button>
            )}
            <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
              Avbryt
            </Button>
            {rulesPreview.blocks.length > 0 && hasOrdreWrite ? (
              <Button
                type="button"
                variant="brand"
                onClick={() => setOverrideOpen(true)}
                disabled={submitting}
              >
                Overstyr …
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => handleSave()}
                disabled={submitting || rulesPreview.blocks.length > 0}
                title={
                  rulesPreview.blocks.length > 0
                    ? "Ordren bryter en leveringsregel"
                    : undefined
                }
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isEdit ? "Lagre endringer" : "Opprett kundeordre"}
              </Button>
            )}
          </DialogFooter>

        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett kundeordre?</AlertDialogTitle>
            <AlertDialogDescription>
              Dette fjerner ordren og alle ordrelinjer permanent. Handlingen kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ZeroPriceConfirmDialog
        open={zeroPriceOpen}
        onOpenChange={setZeroPriceOpen}
        count={riskyPriceLines}
        onConfirm={() => {
          setZeroPriceOpen(false);
          setZeroPriceConfirmed(true);
          void handleSave(pendingSaveReason, true);
        }}
      />

      <UnsavedChangesDialog
        {...unsavedGuard.dialogProps}
        description="Ordren har endringer som ikke er lagret. Forkaster du dem, forsvinner de."
      />

      <OverrideRuleDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        blocks={rulesPreview.blocks}
        contextLine={`Ordre til ${customer.display_name} · levering ${deliveryDate}`}
        submitting={submitting}
        onConfirm={async (reason) => {
          setPendingOverrideReason(reason);
          setOverrideOpen(false);
          await handleSave(reason);
        }}
      />


      {(() => {
        const activeLine = lines.find((l) => l.uid === merknadFor);
        if (!activeLine || !activeLine.product) return null;
        const profile = getLineProfile(activeLine.product.id);
        if (!profile) return null;
        const initial: Merknad = activeLine.merknad ?? {
          bestilt_av: name,
          telefon: "",
          sukkerbilde: null,
          fyll: "",
          tekst: "",
          pynt: "",
          fritekst_1: "",
          fritekst_2: "",
          fritekst_3: "",
          sendes_med: "",
          tid: "",
          antall_etiketter: null,
        };
        return (
          <MerknadDialog
            open={!!merknadFor}
            onOpenChange={(v) => { if (!v) setMerknadFor(null); }}
            orderLineId={activeLine.id ?? null}
            deliveryDate={deliveryDate}

            productName={activeLine.product.display_name}
            quantity={Number(activeLine.quantity) || 0}
            profile={profile}
            initial={initial}
            canEdit
            isSaving={false}
            onSave={(m) => {
              setLines((prev) => prev.map((x) => (x.uid === activeLine.uid ? { ...x, merknad: m } : x)));
              setMerknadFor(null);
            }}
            onClear={() => {
              setLines((prev) => prev.map((x) => (x.uid === activeLine.uid ? { ...x, merknad: null } : x)));
              setMerknadFor(null);
            }}
          />
        );
      })()}
    </>

  );
}

function NameField({
  customerId,
  value,
  onChange,
  onPickSuggestion,
  labelSuffix,
}: {
  customerId: string;
  value: string;
  onChange: (v: string) => void;
  onPickSuggestion: (s: { name: string; email: string | null; phone: string | null }) => void;
  labelSuffix?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const debounced = useDebouncedValue(value, 200);
  const { data: suggestions } = useFinalCustomerSuggestions(customerId, debounced);
  const hasResults = (suggestions?.length ?? 0) > 0;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="cf-name">
        Navn <span className="text-destructive">*</span>
        {labelSuffix}
      </Label>
      <div className="relative">
        <Input
          id="cf-name"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // delay to allow click on suggestion
            window.setTimeout(() => setOpen(false), 150);
          }}
          placeholder="Sluttkundens navn"
          autoComplete="off"
          required
        />
        {open && hasResults && (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md"
            role="listbox"
            aria-live="polite"
          >
            {(suggestions ?? []).map((s) => (
              <button
                key={s.name}
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full flex-col items-start border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPickSuggestion(s);
                  setOpen(false);
                }}
              >
                <span className="font-medium">{s.name}</span>
                {(s.email || s.phone) && (
                  <span className="text-xs text-muted-foreground">
                    {[s.email, s.phone].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { ArrowLeft, Loader2, Plus, Trash2, AlertTriangle, Check, Search, Copy } from "lucide-react";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { tomorrow, todayISO, formatNOK } from "@/ordre/lib/format";
import { type CustomerOption } from "@/ordre/hooks/useNBCustomers";
import { fetchEffectivePrice, type ProductOption } from "@/ordre/hooks/useNBProducts";
import { CustomerCombobox } from "@/ordre/components/orders/CustomerCombobox";
import { ProductSearchInput } from "@/ordre/components/orders/ProductSearchInput";
import { PriceSourceBadge } from "@/ordre/components/orders/PriceSourceBadge";
import { ZeroPriceConfirmDialog } from "@/ordre/components/orders/ZeroPriceConfirmDialog";
import { PriceOverrideReasonDialog } from "@/ordre/components/orders/PriceOverrideReasonDialog";
import {
  calcLineTotals,
  countRiskyPriceLines,
  focusOrderLineField,
  isManualOverride,
  isPriceRisky,
  MANUAL_PRICE_SOURCE,
  PRICE_OVERRIDE_NOTE_PREFIX,
  shouldRepriceCopiedLine,
  withPriceOverrideNote,
} from "@/ordre/lib/orderLines";
import { logAudit } from "@/ordre/lib/audit";
import { logTicketEvent } from "@/ordre/lib/ticketEvents";
import { TourPicker } from "@/ordre/components/orders/TourPicker";
import { CopyFromPreviousOrderDialog } from "@/ordre/components/orders/CopyFromPreviousOrderDialog";
import { DuplicateOrderWarning } from "@/ordre/components/orders/DuplicateOrderWarning";
import { useDuplicateOrderCheck } from "@/ordre/hooks/useDuplicateOrderCheck";
import { usePreviewDeliveryRules } from "@/ordre/hooks/usePreviewDeliveryRules";
import { DeliveryRulesFeedback } from "@/ordre/components/rules/DeliveryRulesFeedback";
import { OverrideRuleDialog } from "@/ordre/components/rules/OverrideRuleDialog";
import { useUserAccess } from "@/ordre/hooks/useUserAccess";
import { useAuth } from "@/hooks/useAuth";
import type { CopyableOrderLine } from "@/ordre/hooks/useRecentOrdersForCustomer";
import { QaChecklistCard } from "@/ordre/components/orders/QaChecklistCard";
import { evaluateOrderDraftChecks, summarizeQa } from "@/ordre/lib/qaChecks";
import { normalizeAiSuggestion, type AiSuggestion } from "@/ordre/lib/aiSuggestion";

type LineDraft = {
  uid: string;
  product: ProductOption | null;
  quantity: string;
  unit_price: string;
  unit_price_source: string | null;
  unit_price_source_id: string | null;
  effective_price: number | null;
  discount_percent: string;
  vat_rate: number;
  notes: string;
};

function newLine(): LineDraft {
  return {
    uid: crypto.randomUUID(),
    product: null,
    quantity: "1",
    unit_price: "0",
    unit_price_source: null,
    unit_price_source_id: null,
    effective_price: null,
    discount_percent: "0",
    vat_rate: 15,
    notes: "",
  };
}

export default function NewOrder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefilledCustomerId = searchParams.get("customer_id");
  const ticketId = searchParams.get("ticket_id");
  const isReturnFromUrl = searchParams.get("is_return") === "true";
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [isReturn] = useState<boolean>(isReturnFromUrl);
  const [ticketBanner, setTicketBanner] = useState<string | null>(null);
  const [ticketAi, setTicketAi] = useState<AiSuggestion | null>(null);
  const [ticketBodyText, setTicketBodyText] = useState<string | null>(null);
  const [qaOverride, setQaOverride] = useState(false);

  // Pre-velg kunde fra URL-param ved første render
  useEffect(() => {
    if (!prefilledCustomerId || customer) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, customer_number, display_name, organization_number, primary_contact_name, primary_contact_email, invoice_recipient_customer_id, delivery_address_line1, delivery_address_line2, delivery_postal_code, delivery_city, delivery_country, delivery_instructions, custom_reference, enforce_custom_reference, default_price_list_id")
        .eq("id", prefilledCustomerId)
        .maybeSingle();
      if (cancelled || !data) return;
      setCustomer(data as unknown as CustomerOption);
    })();
    return () => { cancelled = true; };
  }, [prefilledCustomerId, customer]);

  // Pre-fyll fra ticket (hvis ticket_id i URL) — bruker AI-forslag når tilgjengelig
  useEffect(() => {
    if (!ticketId) return;
    let cancelled = false;
    (async () => {
      const { data: t } = await supabase
        .from("tickets")
        .select("subject, sender_email, sender_name, body_text, body_preview, ai_suggestion")
        .eq("id", ticketId).maybeSingle();
      if (cancelled || !t) return;
      setTicketAi(normalizeAiSuggestion((t as any).ai_suggestion));
      setTicketBodyText(((t as any).body_text ?? (t as any).body_preview ?? null) as string | null);
      const ai = (t as any).ai_suggestion as null | {
        customer_match?: { customer_id: string | null; customer_name?: string | null } | null;
        order_fields?: Record<string, string | null | undefined>;
        products?: Array<{
          product_id: string | null;
          product_name: string;
          quantity: number;
          size_or_servings?: string | null;
          flavor?: string | null;
          filling?: string | null;
          decoration?: string | null;
        }>;
      };
      const senderName = (t as any).sender_name as string | null | undefined;

      // Velg kunde: 1) AI-match, 2) sender_email-ilike
      let pickedCustomer: CustomerOption | null = null;
      if (!customer && !prefilledCustomerId) {
        const aiCustomerId = ai?.customer_match?.customer_id ?? null;
        if (aiCustomerId) {
          const { data: c } = await supabase
            .from("customers")
            .select("id, customer_number, display_name, organization_number, primary_contact_name, primary_contact_email, invoice_recipient_customer_id, delivery_address_line1, delivery_address_line2, delivery_postal_code, delivery_city, delivery_country, delivery_instructions, custom_reference, enforce_custom_reference, default_price_list_id")
            .eq("id", aiCustomerId).maybeSingle();
          if (c) pickedCustomer = c as unknown as CustomerOption;
        }
        if (!pickedCustomer && t.sender_email) {
          const { data: c } = await supabase
            .from("customers")
            .select("id, customer_number, display_name, organization_number, primary_contact_name, primary_contact_email, invoice_recipient_customer_id, delivery_address_line1, delivery_address_line2, delivery_postal_code, delivery_city, delivery_country, delivery_instructions, custom_reference, enforce_custom_reference, default_price_list_id")
            .ilike("primary_contact_email", t.sender_email)
            .maybeSingle();
          if (c) pickedCustomer = c as unknown as CustomerOption;
        }
        if (cancelled) return;
        if (pickedCustomer) {
          setCustomer(pickedCustomer);
          setTicketBanner(`Pre-utfylt fra ticket: ${t.subject ?? "(uten emne)"}${ai ? " · AI-forslag brukt" : ""}`);
        } else {
          setTicketBanner(`Avsender (${t.sender_email}) ikke matchet — velg kunde manuelt.`);
        }
      }

      // Bruk AI-forslag til ordrefelt og notater (kun hvis ikke allerede satt)
      const of = ai?.order_fields ?? {};
      if (of.delivery_date) setDeliveryDate((prev) => (prev === tomorrow() ? String(of.delivery_date) : prev));
      if (of.delivery_time) setDeliveryTime((prev) => prev || String(of.delivery_time));
      if (of.delivery_address_line1 || of.delivery_city || of.delivery_postal_code) {
        setUseCustomerAddress(false);
        setDelAddr((prev) => ({
          line1: prev.line1 || (of.delivery_address_line1 ?? ""),
          line2: prev.line2 || (of.delivery_address_line2 ?? ""),
          postal: prev.postal || (of.delivery_postal_code ?? ""),
          city: prev.city || (of.delivery_city ?? ""),
          country: prev.country || "NO",
        }));
      }
      if (of.customer_notes) setCustomerNotes((prev) => prev || String(of.customer_notes));

      // Bygg internt notat med AI-detaljer
      const noteParts: string[] = [`Opprettet fra ticket: ${t.subject ?? "(uten emne)"}`];
      if (of.contact_phone) noteParts.push(`Telefon: ${of.contact_phone}`);
      if (of.internal_notes) noteParts.push(of.internal_notes);
      // Produktforslag uten match — som hint i notatet
      const unmatched = (ai?.products ?? []).filter((p) => !p.product_id);
      if (unmatched.length > 0) {
        noteParts.push(`AI foreslo (uten match): ${unmatched.map((p) => `${p.quantity}× ${p.product_name}`).join(", ")}`);
      }
      setInternalNotes((prev) => prev || noteParts.join("\n"));

      // Produksjonsnotat — bruk AI-felt direkte, fall back til strukturert oppsummering
      const prodFromAi = (of.production_notes ?? "").trim();
      let productionFallback = "";
      if (!prodFromAi) {
        const lines: string[] = [];
        const aiProducts = ai?.products ?? [];
        for (const p of aiProducts) {
          const parts = [`${p.quantity}× ${p.product_name}`];
          if (p.size_or_servings) parts.push(p.size_or_servings);
          if (p.flavor) parts.push(`smak: ${p.flavor}`);
          if (p.filling) parts.push(`fyll: ${p.filling}`);
          if (p.decoration) parts.push(`pynt: ${p.decoration}`);
          lines.push(`Produkt: ${parts.join(" · ")}`);
        }
        if (of.cake_text) lines.push(`Kaketekst: ${of.cake_text}`);
        if (of.allergies) lines.push(`Allergier: ${of.allergies}`);
        if (of.special_requests) lines.push(`Spesialønsker: ${of.special_requests}`);
        productionFallback = lines.join("\n");
      }
      setProductionNotes((prev) => prev || prodFromAi || productionFallback);

      // Butikknotat — bruk AI-felt direkte, fall back til strukturert oppsummering
      const storeFromAi = (of.store_notes ?? "").trim();
      let storeFallback = "";
      if (!storeFromAi) {
        const lines: string[] = [];
        if (of.delivery_time) lines.push(`Hentetid: ${of.delivery_time}`);
        const customerName = ai?.customer_match?.customer_name ?? senderName ?? null;
        if (customerName) lines.push(`Kunde: ${customerName}`);
        if (of.contact_phone) lines.push(`Telefon: ${of.contact_phone}`);
        if (of.pickup_location_hint) lines.push(`Hentested: ${of.pickup_location_hint}`);
        storeFallback = lines.join("\n");
      }
      setStoreNotes((prev) => prev || storeFromAi || storeFallback);

      // Forhåndsutfyll produktlinjer fra AI-treff (kun med product_id)
      const matched = (ai?.products ?? []).filter((p) => p.product_id);
      if (matched.length > 0) {
        try {
          const ids = matched.map((p) => p.product_id!) as string[];
          const { data: prods } = await supabase
            .from("products")
            .select("id, display_number, code, display_name, unit_of_sale, mva_rate, status, is_for_sale, is_divisible, legal_entity_id")
            .in("id", ids);
          if (cancelled || !prods) return;
          const byId = new Map(prods.map((p: any) => [p.id, p]));
          const newLines: LineDraft[] = matched
            .map((m): LineDraft | null => {
              const p = byId.get(m.product_id!) as ProductOption | undefined;
              if (!p) return null;
              return {
                ...newLine(),
                product: p,
                quantity: String(m.quantity || 1),
                vat_rate: Number(p.mva_rate ?? 15),
              };
            })
            .filter((x): x is LineDraft => x !== null);
          if (newLines.length > 0) {
            setLines((prev) => {
              // Bytt ut bare hvis bruker ikke har lagt til noe ennå
              const onlyEmpty = prev.length === 1 && !prev[0].product;
              return onlyEmpty ? newLines : prev;
            });
          }
        } catch (err) {
          console.warn("Kunne ikke forhåndsutfylle produkter fra AI:", err);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);
  const [deliveryDate, setDeliveryDate] = useState<string>(tomorrow());
  const [deliveryTime, setDeliveryTime] = useState<string>("");
  const [useCustomerAddress, setUseCustomerAddress] = useState(true);
  const [delAddr, setDelAddr] = useState({
    line1: "",
    line2: "",
    postal: "",
    city: "",
    country: "NO",
  });
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [productionNotes, setProductionNotes] = useState("");
  const [storeNotes, setStoreNotes] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const enforceRef = !!customer?.enforce_custom_reference;
  const enforcedRefValue = customer?.custom_reference?.trim() ?? "";
  const enforcedRefMissing = enforceRef && !enforcedRefValue;
  const [manualTourId, setManualTourId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const linesRef = useRef<LineDraft[]>(lines);
  linesRef.current = lines;
  const [submitting, setSubmitting] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  /** Settes når ordren er lagret — da skal ikke ulagret-vakten slå til. */
  const [savedOrder, setSavedOrder] = useState(false);
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;
  const today = todayISO();

  // 6.2 Dublett-sjekk
  const { data: duplicates = [] } = useDuplicateOrderCheck(customer?.id ?? null, deliveryDate);

  // Hent effektiv prisliste for kunden (default eller via gruppe/profil)
  const { data: effectivePriceListId = null } = useQuery({
    queryKey: ["customer-effective-price-list", customer?.id ?? null],
    enabled: !!customer?.id,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.rpc("customer_effective_price_list", {
        _customer_id: customer!.id,
      });
      if (error) throw error;
      return (data as string | null) ?? customer?.default_price_list_id ?? null;
    },
  });
  const productPriceListId = effectivePriceListId ?? customer?.default_price_list_id ?? null;

  // Leveringsregel-preview (SQL-motor)
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const hasOrdreWrite = access?.hasOrdreWrite ?? false;
  const productIdsForCheck = lines
    .map((l) => l.product?.id)
    .filter((id): id is string => !!id);
  const rulesPreview = usePreviewDeliveryRules({
    legalEntityId: NB_LEGAL_ENTITY_ID,
    customerId: customer?.id ?? null,
    deliveryDate: deliveryDate || null,
    deliveryTourId: manualTourId,
    productIds: productIdsForCheck,
  });
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [pendingOverrideReason, setPendingOverrideReason] = useState<string | null>(null);

  // Når kunde endres: pre-fyll adresse + håndter kunde-referanse
  useEffect(() => {
    if (customer) {
      setDelAddr({
        line1: customer.delivery_address_line1 ?? "",
        line2: customer.delivery_address_line2 ?? "",
        postal: customer.delivery_postal_code ?? "",
        city: customer.delivery_city ?? "",
        country: customer.delivery_country ?? "NO",
      });
      setDeliveryInstructions(customer.delivery_instructions ?? "");
      if (customer.enforce_custom_reference) {
        const ref = customer.custom_reference?.trim() ?? "";
        setCustomerReference(ref);
        toast.message("Referanse oppdatert fra kundeprofilen", {
          description: ref ? `Fast referanse: ${ref}` : "Kunden krever fast referanse, men ingen er satt på profilen.",
        });
      }
      // Hvis ikke enforce: behold det brukeren evt. har skrevet (eller default tomt).
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);

  // Re-trekk priser hvis kunde eller dato endres
  useEffect(() => {
    if (!customer) return;
    const cust = customer;
    const date = deliveryDate;
    setLines((prev) => prev.map((l) => (l.product ? { ...l, _refetch: Date.now() } as LineDraft : l)));
    // For hver linje med produkt: hent ny pris, og flett KUN prisfeltene inn
    // med funksjonell oppdatering (brukerens mengde/rabatt/notat bevares).
    void (async () => {
      const snapshot = linesRef.current;
      const results = await Promise.all(
        snapshot.map(async (l) => {
          if (!l.product || l.unit_price_source === "manual_override") return null;
          try {
            const ep = await fetchEffectivePrice({
              productId: l.product.id,
              customerId: cust.id,
              date,
              caller: "new_order_form",
            });
            if (!ep) return null;
            return {
              uid: l.uid,
              productId: l.product.id,
              unit_price: String(ep.price ?? 0),
              unit_price_source: ep.source,
              unit_price_source_id: ep.special_price_id ?? ep.price_list_id ?? null,
              effective_price: ep.price,
            };
          } catch {
            return null;
          }
        }),
      );
      type PriceUpdate = NonNullable<(typeof results)[number]>;
      const byUid = new Map<string, PriceUpdate>(
        results.filter((r): r is PriceUpdate => r !== null).map((r) => [r.uid, r]),
      );
      if (byUid.size === 0) return;
      setLines((prev) =>
        prev.map((l) => {
          const upd = byUid.get(l.uid);
          // Ikke overskriv hvis brukeren har byttet produkt eller låst prisen i mellomtiden
          if (!upd || !l.product || l.product.id !== upd.productId) return l;
          if (l.unit_price_source === "manual_override") return l;
          return {
            ...l,
            unit_price: upd.unit_price,
            unit_price_source: upd.unit_price_source,
            unit_price_source_id: upd.unit_price_source_id,
            effective_price: upd.effective_price,
          };
        }),
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id, deliveryDate]);


  // 6.4 Keyboard shortcut: Cmd/Ctrl+Enter = opprett ordre
  // (A.5.5.8: interne ordre opprettes alltid som confirmed; ingen "lagre som utkast")
  const saveRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (!submittingRef.current) void saveRef.current();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function selectProductForLine(uid: string, p: ProductOption) {
    const ep = customer
      ? await fetchEffectivePrice({ productId: p.id, customerId: customer.id, date: deliveryDate, caller: "new_order_form" }).catch(() => null)
      : null;
    setLines((prev) =>
      prev.map((l) =>
        l.uid === uid
          ? {
              ...l,
              product: p,
              vat_rate: Number(p.mva_rate),
              unit_price: ep ? String(ep.price ?? 0) : "0",
              unit_price_source: ep?.source ?? null,
              unit_price_source_id: ep?.special_price_id ?? ep?.price_list_id ?? null,
              effective_price: ep?.price ?? null,
            }
          : l,
      ),
    );
  }

  function updateLine(uid: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }

  function setManualPrice(uid: string, value: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.uid !== uid) return l;
        const isOverride = l.effective_price !== null && Number(value) !== Number(l.effective_price);
        return {
          ...l,
          unit_price: value,
          unit_price_source: isOverride ? "manual_override" : l.unit_price_source,
        };
      }),
    );
  }

  function removeLine(uid: string) {
    setLines((prev) => prev.filter((l) => l.uid !== uid));
  }

  function addEmptyLine() {
    setLines((p) => [...p, newLine()]);
  }

  // 6.1 Kopier linjer fra tidligere ordre
  async function copyLinesFromOrder(copied: CopyableOrderLine[], orderNumber: string) {
    // Hent produkt-detaljer for hver linje
    const productIds = Array.from(new Set(copied.map((l) => l.product_id)));
    const { data: products, error } = await supabase
      .from("products")
      .select("id, code, display_name, display_number, unit_of_sale, mva_rate, status, is_for_sale, is_divisible")
      .in("id", productIds);
    if (error) {
      toast.error(error.message);
      return;
    }
    const productMap = new Map((products ?? []).map((p) => [p.id, p]));

    const newLines: LineDraft[] = copied.map((cl) => {
      const p = productMap.get(cl.product_id);
      const productOption: ProductOption | null = p
        ? {
            id: p.id,
            code: p.code,
            display_name: p.display_name,
            display_number: p.display_number,
            unit_of_sale: p.unit_of_sale,
            mva_rate: Number(p.mva_rate),
            status: p.status,
            is_for_sale: p.is_for_sale,
            is_divisible: !!(p as any).is_divisible,
          }
        : null;
      return {
        uid: crypto.randomUUID(),
        product: productOption,
        quantity: String(cl.quantity),
        unit_price: String(cl.unit_price),
        unit_price_source: cl.unit_price_source,
        unit_price_source_id: cl.unit_price_source_id,
        effective_price: cl.unit_price,
        discount_percent: String(cl.discount_percent),
        vat_rate: cl.vat_rate,
        notes: cl.notes ?? "",
      };
    });

    // Erstatt eksisterende tomme linjer hvis det bare er én tom rad
    setLines((prev) => {
      const hasOnlyEmpty = prev.length === 1 && prev[0].product === null;
      return hasOnlyEmpty ? newLines : [...prev, ...newLines];
    });

    // Re-trekk priser for ny kunde/dato (samme logikk som i useEffect)
    if (customer) {
      void (async () => {
        const refreshed = await Promise.all(
          newLines.map(async (l) => {
            if (!l.product) return l;
            try {
              const ep = await fetchEffectivePrice({
                productId: l.product.id,
                customerId: customer.id,
                date: deliveryDate,
                caller: "new_order_form",
              });
              if (!ep) return l;
              return {
                ...l,
                unit_price: String(ep.price ?? 0),
                unit_price_source: ep.source,
                unit_price_source_id: ep.special_price_id ?? ep.price_list_id ?? null,
                effective_price: ep.price,
              };
            } catch {
              return l;
            }
          }),
        );
        setLines((prev) => {
          // Bare oppdater de nye linjene
          const newUids = new Set(newLines.map((l) => l.uid));
          return prev.map((l) => (newUids.has(l.uid) ? refreshed.find((r) => r.uid === l.uid) ?? l : l));
        });
      })();
    }
  }

  // Totaler
  const totals = lines.reduce(
    (acc, l) => {
      if (!l.product) return acc;
      const t = calcLineTotals(l);
      acc.subtotal += t.subtotal;
      acc.vat += t.vat;
      acc.total += t.total;
      const qty = Number(l.quantity) || 0;
      const price = Number(l.unit_price) || 0;
      const disc = Number(l.discount_percent) || 0;
      acc.discount += qty * price * (disc / 100);
      return acc;
    },
    { subtotal: 0, vat: 0, total: 0, discount: 0 },
  );

  // QA-sjekkliste før ordre lagres
  const qaChecks = useMemo(() => {
    return evaluateOrderDraftChecks({
      delivery_date: deliveryDate || null,
      delivery_time: deliveryTime || null,
      has_pickup_concept: !!ticketAi?.order_fields?.pickup_location_hint,
      pickup_location_hint: ticketAi?.order_fields?.pickup_location_hint ?? null,
      pickup_location_known: true,
      lines: lines.map((l) => ({
        product_id: l.product?.id ?? null,
        product_name: l.product?.display_name ?? null,
        quantity: Number(l.quantity) || 0,
      })),
      customer_id: customer?.id ?? null,
      ai: ticketAi,
      source_text: ticketBodyText,
    });
  }, [deliveryDate, deliveryTime, lines, customer?.id, ticketAi, ticketBodyText]);
  const qaSummary = summarizeQa(qaChecks);

  async function save(overrideReason: string | null = pendingOverrideReason) {
    if (!customer) {
      toast.error("Velg en kunde");
      return;
    }
    if (!deliveryDate || deliveryDate < today) {
      toast.error("Leveringsdato kan ikke være i fortiden");
      return;
    }
    const validLines = lines.filter((l) => l.product && Number(l.quantity) > 0);
    if (validLines.length === 0) {
      toast.error("Du må legge til minst én ordrelinje for å opprette ordren");
      return;
    }
    const badQty = validLines.find((l) => !l.product?.is_divisible && !Number.isInteger(Number(l.quantity)));
    if (badQty) {
      toast.error(`Mengde for "${badQty.product?.display_name}" må være et helt tall`);
      return;
    }
    // QA: blokkér på røde sjekker med mindre brukeren har bekreftet override
    if (qaSummary.severity === "red" && !qaOverride) {
      toast.error("Kvalitetssikring: røde punkter må løses (eller bekreft override)");
      return;
    }
    if (rulesPreview.blocks.length > 0 && !overrideReason) {
      toast.error(
        `Kan ikke lagre — bryter leveringsregel: ${rulesPreview.blocks[0].message}`,
      );
      return;
    }


    setSubmitting(true);
    try {
      // Hent ordrenummer
      const { data: numData, error: numErr } = await supabase.rpc("next_order_number", {
        p_legal_entity_id: NB_LEGAL_ENTITY_ID,
      });
      if (numErr) throw numErr;
      const numRow = numData?.[0];
      if (!numRow) throw new Error("Kunne ikke generere ordrenummer");

      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id ?? null;

      const customerSnapshot = {
        customer_number: customer.customer_number,
        display_name: customer.display_name,
        organization_number: customer.organization_number,
        primary_contact_name: customer.primary_contact_name,
        primary_contact_email: customer.primary_contact_email,
      };

      // Opprett ordre
      const { data: orderRow, error: orderErr } = await supabase
        .from("orders")
        .insert({
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          order_number: numRow.order_number,
          order_year: numRow.order_year,
          order_sequence: numRow.order_sequence,
          source: ticketId ? "ticket" : "manual",
          source_reference: ticketId ?? null,
          customer_id: customer.id,
          customer_snapshot: customerSnapshot,
          invoice_recipient_customer_id: customer.invoice_recipient_customer_id,
          status: "confirmed",
          status_changed_by: userId,
          delivery_date: deliveryDate,
          delivery_time: deliveryTime || null,
          delivery_address_line1: useCustomerAddress ? customer.delivery_address_line1 : delAddr.line1 || null,
          delivery_address_line2: useCustomerAddress ? customer.delivery_address_line2 : delAddr.line2 || null,
          delivery_postal_code: useCustomerAddress ? customer.delivery_postal_code : delAddr.postal || null,
          delivery_city: useCustomerAddress ? customer.delivery_city : delAddr.city || null,
          delivery_country: useCustomerAddress ? customer.delivery_country : delAddr.country || "NO",
          delivery_instructions: deliveryInstructions || null,
          use_customer_default_address: useCustomerAddress,
          internal_notes: internalNotes?.trim() || null,
          rule_override_reason: overrideReason,
          production_notes: productionNotes.trim() || null,
          store_notes: storeNotes.trim() || null,
          customer_notes: customerNotes || null,
          customer_reference: (customer.enforce_custom_reference
            ? (customer.custom_reference?.trim() || null)
            : (customerReference.trim() || null)),
          delivery_tour_id: manualTourId, // null lar trigger auto-tildele
          is_return: isReturn,
          created_by: userId,
        })
        .select("id")
        .single();
      if (orderErr) throw orderErr;

      // Sett inn linjer
      if (validLines.length > 0) {
        const lineRows = validLines.map((l, idx) => {
          const t = calcLineTotals(l);
          return {
            order_id: orderRow.id,
            line_number: idx + 1,
            product_id: l.product!.id,
            product_snapshot: {
              display_number: l.product!.display_number,
              display_name: l.product!.display_name,
              code: l.product!.code,
              unit_of_sale: l.product!.unit_of_sale,
              mva_rate: l.product!.mva_rate,
            },
            quantity: Number(l.quantity),
            sales_unit: l.product!.unit_of_sale,
            unit_price: Number(l.unit_price),
            unit_price_source: l.unit_price_source,
            unit_price_source_id: l.unit_price_source_id,
            discount_percent: Number(l.discount_percent),
            line_subtotal_excl_vat: Number(t.subtotal.toFixed(2)),
            vat_rate: Number(l.vat_rate),
            line_vat: Number(t.vat.toFixed(2)),
            line_total_incl_vat: Number(t.total.toFixed(2)),
            notes: l.notes || null,
          };
        });
        const { error: lineErr } = await supabase.from("order_lines").insert(lineRows);
        if (lineErr) {
          // Rull tilbake ordrehodet så vi aldri etterlater en bekreftet ordre uten linjer
          await supabase.from("orders").delete().eq("id", orderRow.id);
          throw lineErr;
        }
      }


      await logAudit({
        action: "created",
        entity_type: "order",
        entity_id: orderRow.id,
        entity_display_reference: `${numRow.order_number} — ${customer.display_name}`,
        legal_entity_id: NB_LEGAL_ENTITY_ID,
        changes: { status: "confirmed", line_count: validLines.length },
      });

      // Hvis opprettet fra ticket: link ticket og sett status=in_progress
      if (ticketId) {
        await supabase.from("tickets")
          .update({ related_order_id: orderRow.id, status: "in_progress" })
          .eq("id", ticketId);
        await logTicketEvent({
          ticket_id: ticketId,
          order_id: orderRow.id,
          event_type: "order.created_from_ticket",
          summary: `${numRow.order_number} · ${customer.display_name}`,
          payload: { order_number: numRow.order_number, line_count: validLines.length },
        });
      }

      toast.success(`Ordre ${numRow.order_number} opprettet`);
      setSavedOrder(true);
      navigate("/ordre/ordrer");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre ordre");
    } finally {
      setSubmitting(false);
    }
  }

  // Bind save til ref for keyboard shortcuts
  saveRef.current = save;

  /** Ulagret-vakt: ordreutkast med kunde eller varelinjer skal ikke forsvinne stille. */
  const hasDraftLines = lines.some((l) => l.product || Number(l.quantity) > 0);
  const unsavedGuard = useUnsavedChangesGuard(!savedOrder && (!!customer || hasDraftLines));

  return (
    <>
      <UnsavedChangesDialog
        {...unsavedGuard.dialogProps}
        description="Ordreutkastet er ikke lagret ennå. Forkaster du det, forsvinner linjene du har lagt inn."
      />
      <AppBanner
        title={isReturn ? "Ny returordre" : "Ny ordre"}
        subtitle={isReturn ? "Manuell registrering av returordre" : "Manuell registrering av salgsordre"}
        actions={
          <Button asChild variant="outline" className="gap-2 border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white">
            <Link to="/ordre/ordrer">
              <ArrowLeft className="h-4 w-4" /> Tilbake
            </Link>
          </Button>
        }
      />
      <div className="container mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
        {ticketBanner && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            {ticketBanner}
          </div>
        )}
        {/* Seksjon 1: Kunde */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">1. Kunde</CardTitle>
            {customer && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setCopyDialogOpen(true)}
              >
                <Copy className="h-3.5 w-3.5" />
                Kopier fra tidligere ordre
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <CustomerCombobox value={customer} onSelect={setCustomer} />
            {customer && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{customer.display_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {customer.customer_number}
                      {customer.organization_number ? ` · ${customer.organization_number}` : ""}
                    </div>
                    {customer.primary_contact_name && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Kontakt: {customer.primary_contact_name}
                        {customer.primary_contact_email ? ` · ${customer.primary_contact_email}` : ""}
                      </div>
                    )}
                  </div>
                  {customer.credit_hold && (
                    <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                      <AlertTriangle className="h-3 w-3" /> Kredittstopp
                    </span>
                  )}
                </div>
                {customer.invoice_recipient_customer_id && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Faktura sendes til annen mottaker (innstilt på kunden).
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 6.2 Dublett-advarsel */}
        {customer && deliveryDate && duplicates.length > 0 && (
          <DuplicateOrderWarning
            duplicates={duplicates}
            customerName={customer.display_name}
            deliveryDate={deliveryDate}
          />
        )}

        {/* Leveringsregler (blokk/advarsel/info) */}
        {customer && deliveryDate && (
          <DeliveryRulesFeedback
            blocks={rulesPreview.blocks}
            warns={rulesPreview.warns}
            infos={rulesPreview.infos}
            blockedHint={
              rulesPreview.blocks.length > 0 && !hasOrdreWrite
                ? "Ordren kan ikke opprettes. Kontakt ordrekontoret hvis den likevel må gjennom."
                : undefined
            }
          />
        )}

        {/* Seksjon 2: Levering */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Leveringsinfo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="del-date">Leveringsdato</Label>
                <Input
                  id="del-date"
                  type="date"
                  min={today}
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="del-time">Leveringstid (valgfri)</Label>
                <Input
                  id="del-time"
                  type="time"
                  value={deliveryTime}
                  onChange={(e) => setDeliveryTime(e.target.value)}
                />
              </div>
            </div>

            <TourPicker
              deliveryDate={deliveryDate}
              deliveryTime={deliveryTime}
              manualTourId={manualTourId}
              onChangeManual={setManualTourId}
            />

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <div className="text-sm font-medium">Bruk kundens leveringsadresse</div>
                <div className="text-xs text-muted-foreground">
                  Slå av for å overstyre adressen for denne ordren.
                </div>
              </div>
              <Switch checked={useCustomerAddress} onCheckedChange={setUseCustomerAddress} />
            </div>

            {useCustomerAddress ? (
              customer && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <div>{customer.delivery_address_line1 || <em className="text-muted-foreground">— ingen adresse —</em>}</div>
                  {customer.delivery_address_line2 && <div>{customer.delivery_address_line2}</div>}
                  <div>
                    {customer.delivery_postal_code} {customer.delivery_city}
                  </div>
                  <div className="text-xs text-muted-foreground">{customer.delivery_country}</div>
                </div>
              )
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="Adresselinje 1" value={delAddr.line1} onChange={(e) => setDelAddr({ ...delAddr, line1: e.target.value })} />
                <Input placeholder="Adresselinje 2" value={delAddr.line2} onChange={(e) => setDelAddr({ ...delAddr, line2: e.target.value })} />
                <Input placeholder="Postnr" value={delAddr.postal} onChange={(e) => setDelAddr({ ...delAddr, postal: e.target.value })} />
                <Input placeholder="Sted" value={delAddr.city} onChange={(e) => setDelAddr({ ...delAddr, city: e.target.value })} />
                <Input placeholder="Land" value={delAddr.country} onChange={(e) => setDelAddr({ ...delAddr, country: e.target.value })} />
              </div>
            )}

            <div>
              <Label htmlFor="instr">Merknader til sjåfør</Label>
              <Textarea
                id="instr"
                rows={2}
                value={deliveryInstructions}
                onChange={(e) => setDeliveryInstructions(e.target.value)}
                placeholder="F.eks. portkode, bakdør, leveringssted..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Seksjon 3: Linjer */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">3. Ordrelinjer</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setLines((p) => [...p, newLine()])} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Legg til linje
            </Button>
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
                <p className="text-sm text-muted-foreground">Ingen linjer enda.</p>
                <Button size="sm" variant="outline" onClick={() => setLines((p) => [...p, newLine()])} className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> Legg til første linje
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1fr)_96px_64px_140px_96px_120px_36px] items-center gap-3 border-b border-border pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <div>Produkt</div>
                  <div className="text-right">Mengde</div>
                  <div className="text-center">Enhet</div>
                  <div className="text-right">Pris/enhet</div>
                  <div className="text-right">Rabatt %</div>
                  <div className="text-right">Sum</div>
                  <div></div>
                </div>
                {lines.map((l) => {
                  const t = calcLineTotals(l);
                  const overridden = l.unit_price_source === "manual_override";
                  const isDivisible = !!l.product?.is_divisible;
                  return (
                    <div key={l.uid} className="rounded-md py-2 transition-colors hover:bg-muted/40">
                      <div className="grid grid-cols-[minmax(0,1fr)_96px_64px_140px_96px_120px_36px] items-center gap-3">
                        <div className="min-w-0">
                          {l.product ? (
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{l.product.display_name}</div>
                                <div className="truncate text-xs text-muted-foreground">{l.product.code}</div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => updateLine(l.uid, { product: null, unit_price: "0", effective_price: null, unit_price_source: null })}
                                className="h-7 px-2 text-xs"
                              >
                                Bytt
                              </Button>
                            </div>
                          ) : (
                            <ProductCombobox onSelect={(p) => selectProductForLine(l.uid, p)} priceListId={productPriceListId} />
                          )}
                        </div>
                        <Input
                          type="number"
                          inputMode={isDivisible ? "decimal" : "numeric"}
                          min="1"
                          step={isDivisible ? "0.001" : "1"}
                          value={l.quantity}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!isDivisible) {
                              // tillat tom mens man skriver, ellers kun siffer
                              updateLine(l.uid, { quantity: v.replace(/[^\d]/g, "") });
                            } else {
                              updateLine(l.uid, { quantity: v });
                            }
                          }}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n) || n <= 0) {
                              updateLine(l.uid, { quantity: "1" });
                              return;
                            }
                            if (!isDivisible) {
                              const rounded = Math.max(1, Math.round(n));
                              if (String(rounded) !== l.quantity) updateLine(l.uid, { quantity: String(rounded) });
                            }
                          }}
                          className="h-9 px-2 text-right text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <div className="text-center">
                          {l.product ? (
                            <span className="inline-flex h-6 items-center rounded-md bg-muted px-2 text-xs font-medium text-muted-foreground">
                              {l.product.unit_of_sale}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                        <div className="relative">
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.0001"
                            value={l.unit_price}
                            onChange={(e) => setManualPrice(l.uid, e.target.value)}
                            disabled={!l.product}
                            className="h-9 pr-8 text-right text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            kr
                          </span>
                        </div>
                        <div className="relative">
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            max="100"
                            value={l.discount_percent}
                            onChange={(e) => updateLine(l.uid, { discount_percent: e.target.value })}
                            disabled={!l.product}
                            className="h-9 pr-7 text-right text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            %
                          </span>
                        </div>
                        <div className="text-right text-sm font-semibold tabular-nums">{formatNOK(t.total)}</div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeLine(l.uid)}
                          className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                          aria-label="Fjern linje"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {l.product && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-1 text-xs">
                          <PriceSourceBadge source={l.unit_price_source} />
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
                            MVA {l.vat_rate}%
                          </span>
                          {overridden && l.effective_price !== null && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-warning">
                              <AlertTriangle className="h-3 w-3" />
                              Overstyrt fra {formatNOK(l.effective_price)}
                            </span>
                          )}
                          <Input
                            value={l.notes}
                            onChange={(e) => updateLine(l.uid, { notes: e.target.value })}
                            placeholder="Notat på linje…"
                            className="h-7 max-w-[320px] flex-1 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Totaler */}
            <div className="mt-6 ml-auto max-w-xs space-y-1.5 border-t border-border pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sum eks. mva</span>
                <span className="tabular-nums">{formatNOK(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rabatt</span>
                <span className="tabular-nums">{formatNOK(totals.discount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">MVA</span>
                <span className="tabular-nums">{formatNOK(totals.vat)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Sum inkl. mva</span>
                <span className="tabular-nums">{formatNOK(totals.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>


        {/* Seksjon 4: Notater */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">4. Notater</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="customer-reference" className="flex items-center gap-1.5">
                Kundereferanse
                {enforceRef && (
                  <span
                    title="Fast referanse fra kundeprofil"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
                  >
                    i
                  </span>
                )}
              </Label>
              <Input
                id="customer-reference"
                value={enforceRef ? enforcedRefValue : customerReference}
                onChange={(e) => setCustomerReference(e.target.value)}
                readOnly={enforceRef}
                disabled={enforceRef && !enforcedRefValue}
                placeholder={enforceRef ? "(fast referanse fra kundeprofil)" : "PO-nummer e.l. (valgfritt)"}
                className={enforceRef ? "bg-muted/40" : ""}
                maxLength={100}
              />
              {enforceRef && enforcedRefValue && (
                <p className="mt-1 text-xs text-muted-foreground">Fast referanse fra kundeprofil — kan ikke endres her.</p>
              )}
              {enforcedRefMissing && (
                <p className="mt-1 text-xs text-warning">
                  Kunden krever fast referanse, men ingen er satt på kundeprofilen — kontakt kundeansvarlig.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="internal">Internt notat (ikke synlig for kunde)</Label>
              <Textarea id="internal" rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="production-notes">
                  Produksjonsnotat <span className="text-xs text-muted-foreground">(til bakeriet)</span>
                </Label>
                <Textarea
                  id="production-notes"
                  rows={6}
                  value={productionNotes}
                  onChange={(e) => setProductionNotes(e.target.value)}
                  placeholder={`Produkt: 1× Bløtkake · 8 personer · smak: jordbær\nKaketekst: «Gratulerer med dagen, Eva!»\nPynt: blomster i lilla\nAllergier: nøtter\nObs: …`}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Strukturert, telegrafisk. Kaketekst, pynt, fyll, allergier, ting produksjon må være obs på.
                </p>
              </div>
              <div>
                <Label htmlFor="store-notes">
                  Butikknotat <span className="text-xs text-muted-foreground">(til hentestedet)</span>
                </Label>
                <Textarea
                  id="store-notes"
                  rows={6}
                  value={storeNotes}
                  onChange={(e) => setStoreNotes(e.target.value)}
                  placeholder={`Hentetid: 14:00\nKunde: Eva Hansen\nTelefon: 90000000\nBetaling: betalt på forhånd\nKontakt kunde: bekreft hentetid\nEndret: utvidet med 4 personer 25.05`}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Hentetid, kontaktinfo, betalingsstatus, spesielle hentebeskjeder.
                </p>
              </div>
            </div>
            <div>
              <Label htmlFor="customer-notes">Notat fra kunde</Label>
              <Textarea id="customer-notes" rows={2} value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* QA-sjekkliste før ordre lagres */}
        <QaChecklistCard
          title="Kvalitetssikring før lagring"
          description="Grønn: OK. Gul: bør sjekkes. Rød: må løses før ordre lagres."
          checks={qaChecks}
        />

        {/* Knapper */}
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mr-auto text-sm text-muted-foreground">
            {lines.filter((l) => l.product).length} linjer · {formatNOK(totals.total)}
          </div>
          {qaSummary.severity === "red" && (
            <label className="flex items-center gap-2 text-xs text-destructive">
              <input
                type="checkbox"
                checked={qaOverride}
                onChange={(e) => setQaOverride(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Lagre likevel (overstyr røde varsler)
            </label>
          )}
          <Button variant="ghost" asChild>
            <Link to="/ordre/ordrer">Avbryt</Link>
          </Button>
          {rulesPreview.blocks.length > 0 && hasOrdreWrite ? (
            <Button
              variant="brand"
              onClick={() => setOverrideOpen(true)}
              disabled={submitting || !customer || (qaSummary.severity === "red" && !qaOverride)}
            >
              Overstyr …
            </Button>
          ) : (
            <Button
              onClick={() => save()}
              disabled={
                submitting ||
                !customer ||
                (qaSummary.severity === "red" && !qaOverride) ||
                rulesPreview.blocks.length > 0
              }
              title="⌘Enter / Ctrl+Enter"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Opprett ordre
              <kbd className="ml-2 hidden rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1.5 py-0.5 text-[10px] sm:inline">⌘↵</kbd>
            </Button>
          )}
        </div>
      </div>

      {/* Overstyringsdialog for leveringsregler */}
      <OverrideRuleDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        blocks={rulesPreview.blocks}
        contextLine={customer ? `Ordre til ${customer.display_name} · levering ${deliveryDate}` : undefined}
        submitting={submitting}
        onConfirm={async (reason) => {
          setPendingOverrideReason(reason);
          setOverrideOpen(false);
          await save(reason);
        }}
      />

      {/* 6.1 Kopier fra tidligere ordre */}
      <CopyFromPreviousOrderDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        customerId={customer?.id ?? null}
        customerName={customer?.display_name ?? null}
        onCopy={copyLinesFromOrder}
      />
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { LINE_UNITS, todayIso } from "@/fakturaer/lib/constants";

const lineSchema = z.object({
  supplier_sku: z.string().optional(),
  description: z.string().min(1, "Påkrevd"),
  quantity: z.coerce.number().positive("Må være > 0"),
  unit: z.string().min(1, "Velg enhet"),
  unit_price: z.coerce.number().nonnegative(),
  vat_rate: z.coerce.number().nonnegative().default(15),
});

const schema = z.object({
  legal_entity_id: z.string().uuid("Velg selskap"),
  supplier_id: z.string().uuid("Velg leverandør"),
  invoice_number: z.string().min(1, "Påkrevd"),
  invoice_date: z.string().min(1, "Påkrevd"),
  due_date: z.string().optional(),
  currency: z.string().default("NOK"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "Minst én linje"),
});

type FormData = z.infer<typeof schema>;

export default function NewInvoicePage() {
  const navigate = useNavigate();
  const { canWrite } = useFakturaer();
  const { data: entities = [] } = useFakturaerLegalEntities();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      legal_entity_id: "",
      supplier_id: "",
      invoice_number: "",
      invoice_date: todayIso(),
      due_date: "",
      currency: "NOK",
      notes: "",
      lines: [{ supplier_sku: "", description: "", quantity: 1, unit: "stk", unit_price: 0, vat_rate: 15 }],
    },
  });

  const legalEntityId = form.watch("legal_entity_id");
  const { data: suppliers = [] } = useSuppliersFor(legalEntityId || null);
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const lines = form.watch("lines");

  // Default selskap hvis kun ett
  useEffect(() => {
    if (entities.length === 1 && !legalEntityId) form.setValue("legal_entity_id", entities[0].id);
  }, [entities, legalEntityId, form]);

  // Reset leverandør når selskap byttes
  useEffect(() => {
    form.setValue("supplier_id", "");
  }, [legalEntityId, form]);

  const totals = useMemo(() => {
    let net = 0;
    let vat = 0;
    (lines ?? []).forEach((l) => {
      const lineNet = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
      net += lineNet;
      vat += lineNet * ((Number(l.vat_rate) || 0) / 100);
    });
    return { net, vat, total: net + vat };
  }, [lines]);

  if (!canWrite) {
    return (
      <div className="space-y-5">
        <FakturaerHeaderBanner title="Ny faktura" />
        <Card className="p-8 text-center text-ink-secondary">Du har ikke skrivetilgang til fakturaer.</Card>
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      // 1) Opprett faktura
      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          legal_entity_id: values.legal_entity_id,
          supplier_id: values.supplier_id,
          invoice_number: values.invoice_number,
          invoice_date: values.invoice_date,
          due_date: values.due_date || null,
          currency: values.currency,
          notes: values.notes || null,
          source: "manual",
          status: "imported",
          total_amount: totals.total,
          total_vat: totals.vat,
        })
        .select()
        .single();
      if (invErr) throw invErr;

      // 2) Opprett linjer
      const lineRows = values.lines.map((l, idx) => {
        const lineNet = (l.quantity || 0) * (l.unit_price || 0);
        return {
          invoice_id: invoice.id,
          line_number: idx + 1,
          supplier_sku: l.supplier_sku || null,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unit_price: l.unit_price,
          vat_rate: l.vat_rate,
          total_amount: lineNet,
        };
      });
      const { error: linErr } = await supabase.from("invoice_lines").insert(lineRows);
      if (linErr) throw linErr;

      toast.success("Faktura registrert");

      // 3) Kjør auto-matching (Edge Function — valgfritt, prøv men ikke blokkér)
      try {
        await supabase.functions.invoke("match-invoice-lines", { body: { invoice_id: invoice.id } });
      } catch {
        /* matching kommer i Steg 3 */
      }

      navigate(`/ravarer/fakturaer/${invoice.id}`);
    } catch (e: any) {
      toast.error(`Kunne ikke lagre: ${e.message ?? e}`);
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div className="space-y-5">
      <div>
        <button
          onClick={() => navigate("/ravarer/fakturaer")}
          className="mb-3 flex items-center gap-1 text-sm text-ink-secondary transition-colors hover:text-ink-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Tilbake
        </button>
        <FakturaerHeaderBanner title="Ny faktura" subtitle="Registrer faktura manuelt med linjer" />
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <Card className="p-6">
          <h2 className="mb-4 text-base font-semibold">Hovedinformasjon</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label>Selskap *</Label>
              <Controller
                control={form.control}
                name="legal_entity_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Velg selskap…" /></SelectTrigger>
                    <SelectContent>
                      {entities.map((e) => (<SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.legal_entity_id && (
                <p className="mt-1 text-xs text-destructive">{form.formState.errors.legal_entity_id.message}</p>
              )}
            </div>

            <div>
              <Label>Leverandør *</Label>
              <Controller
                control={form.control}
                name="supplier_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!legalEntityId}>
                    <SelectTrigger><SelectValue placeholder={legalEntityId ? "Velg leverandør…" : "Velg selskap først"} /></SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}{s.org_number ? ` (${s.org_number})` : ""}</SelectItem>
                      ))}
                      {suppliers.length === 0 && legalEntityId && (
                        <div className="p-2 text-xs text-ink-secondary">Ingen aktive leverandører — opprett under Råvarer.</div>
                      )}
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.supplier_id && (
                <p className="mt-1 text-xs text-destructive">{form.formState.errors.supplier_id.message}</p>
              )}
            </div>

            <div>
              <Label>Fakturanr *</Label>
              <Input {...form.register("invoice_number")} placeholder="F.eks. 2026-12345" />
              {form.formState.errors.invoice_number && (
                <p className="mt-1 text-xs text-destructive">{form.formState.errors.invoice_number.message}</p>
              )}
            </div>

            <div>
              <Label>Fakturadato *</Label>
              <Input type="date" {...form.register("invoice_date")} />
            </div>
            <div>
              <Label>Forfallsdato</Label>
              <Input type="date" {...form.register("due_date")} />
            </div>
            <div>
              <Label>Valuta</Label>
              <Input {...form.register("currency")} />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">Linjer</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ supplier_sku: "", description: "", quantity: 1, unit: "stk", unit_price: 0, vat_rate: 15 })}
              className="gap-1"
            >
              <Plus className="h-4 w-4" /> Legg til linje
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-ink-secondary">
                <tr>
                  <th className="pb-2 pr-2">SKU</th>
                  <th className="pb-2 pr-2">Beskrivelse *</th>
                  <th className="pb-2 pr-2 w-[90px]">Antall *</th>
                  <th className="pb-2 pr-2 w-[100px]">Enhet *</th>
                  <th className="pb-2 pr-2 w-[110px]">Pris/enhet</th>
                  <th className="pb-2 pr-2 w-[80px]">MVA %</th>
                  <th className="pb-2 pr-2 w-[110px] text-right">Sum</th>
                  <th className="pb-2 w-[40px]"></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field, idx) => {
                  const ln = lines?.[idx];
                  const sum = (Number(ln?.quantity) || 0) * (Number(ln?.unit_price) || 0);
                  return (
                    <tr key={field.id} className="border-t border-line-subtle">
                      <td className="py-2 pr-2"><Input {...form.register(`lines.${idx}.supplier_sku`)} className="h-8" /></td>
                      <td className="py-2 pr-2"><Input {...form.register(`lines.${idx}.description`)} className="h-8" /></td>
                      <td className="py-2 pr-2"><Input type="number" step="0.001" {...form.register(`lines.${idx}.quantity`)} className="h-8 tabular-nums" /></td>
                      <td className="py-2 pr-2">
                        <Controller
                          control={form.control}
                          name={`lines.${idx}.unit`}
                          render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {LINE_UNITS.map((u) => (<SelectItem key={u} value={u}>{u}</SelectItem>))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </td>
                      <td className="py-2 pr-2"><Input type="number" step="0.01" {...form.register(`lines.${idx}.unit_price`)} className="h-8 tabular-nums" /></td>
                      <td className="py-2 pr-2"><Input type="number" step="0.1" {...form.register(`lines.${idx}.vat_rate`)} className="h-8 tabular-nums" /></td>
                      <td className="py-2 pr-2 text-right tabular-nums">{sum.toFixed(2)}</td>
                      <td className="py-2">
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(idx)} disabled={fields.length === 1}>
                          <Trash2 className="h-4 w-4 text-ink-secondary" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-subtle text-sm">
                  <td colSpan={6} className="pt-3 text-right text-ink-secondary">Netto</td>
                  <td className="pt-3 text-right tabular-nums">{totals.net.toFixed(2)}</td>
                  <td></td>
                </tr>
                <tr>
                  <td colSpan={6} className="pt-1 text-right text-ink-secondary">MVA</td>
                  <td className="pt-1 text-right tabular-nums">{totals.vat.toFixed(2)}</td>
                  <td></td>
                </tr>
                <tr>
                  <td colSpan={6} className="pt-1 text-right font-semibold">Totalt</td>
                  <td className="pt-1 text-right font-semibold tabular-nums">{totals.total.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {form.formState.errors.lines && typeof form.formState.errors.lines.message === "string" && (
            <p className="mt-2 text-xs text-destructive">{form.formState.errors.lines.message}</p>
          )}
        </Card>

        <Card className="p-6">
          <Label>Notater</Label>
          <textarea
            {...form.register("notes")}
            rows={3}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate("/ravarer/fakturaer")} disabled={submitting}>
            Avbryt
          </Button>
          <Button type="submit" disabled={submitting} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Lagre faktura
          </Button>
        </div>
      </form>
    </div>
  );
}

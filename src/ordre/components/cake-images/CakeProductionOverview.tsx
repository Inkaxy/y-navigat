import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Factory, ExternalLink, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { useProductionDepartments } from "@/produksjon/features/produksjonsavdelinger/hooks/useProductionDepartments";
import { QueryState } from "@/components/common/QueryState";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UnitRow = {
  id: string;
  number: number;
  order_id: string | null;
  order_line_id: string | null;
  product_id: string | null;
  product: {
    display_name: string | null;
    label_mode: string | null;
    cake_role: string | null;
    is_cake_component: boolean | null;
  } | null;
  order: {
    order_number: string | null;
    delivery_tour_id: string | null;
    final_customer_name: string | null;
    delivery_tours: { name: string | null } | null;
  } | null;
};

type ImageRow = {
  id: string;
  status: "venter" | "ferdig_redigert" | "skrevet_ut";
  label_unit_id: string | null;
  order_line_id: string | null;
  production_department_id: string | null;
};

type CakeState = "mangler" | "venter" | "ferdig_redigert" | "skrevet_ut";

const STATE_LABEL: Record<CakeState, string> = {
  mangler: "Mangler bilde",
  venter: "Venter",
  ferdig_redigert: "Ferdig redigert",
  skrevet_ut: "Skrevet ut",
};

const STATE_CLASS: Record<CakeState, string> = {
  mangler: "bg-amber-100 text-amber-900 border-amber-300",
  venter: "bg-muted text-foreground border-border",
  ferdig_redigert: "bg-brand-ink text-brand-cream border-brand-ink",
  skrevet_ut: "bg-emerald-100 text-emerald-900 border-emerald-300",
};

const UNSET = "uten-avdeling";

/**
 * Produksjonsvisning: dagens kaker per produksjonsavdeling, med bildestatus.
 * Grunnlaget er etikett-enhetene for dagen (én enhet = én kake) koblet mot
 * kakebildene, slik at «mangler bilde» faktisk vises.
 */
export function CakeProductionOverview({ date }: { date: string }) {
  const [tour, setTour] = useState<string>("all");

  const units = useQuery({
    queryKey: ["cake-production", "units", date],
    queryFn: async (): Promise<UnitRow[]> => {
      const { data, error } = await supabase
        .from("label_units")
        .select(
          "id, number, order_id, order_line_id, product_id, product:products!inner(display_name, label_mode, cake_role, is_cake_component), order:orders(order_number, delivery_tour_id, final_customer_name, delivery_tours(name))",
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("seq_date", date)
        .neq("status", "cancelled")
        // Bare kakeprodukter — filtreres i spørringen, ellers spiser andre
        // etikett-enheter opp grensen på 500.
        .or("label_mode.not.in.(none),cake_role.eq.base,is_cake_component.is.true", {
          referencedTable: "product",
        })
        .order("number", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as UnitRow[];

    },
  });

  const images = useQuery({
    queryKey: ["cake-production", "images", date],
    queryFn: async (): Promise<ImageRow[]> => {
      const { data, error } = await supabase
        .from("cake_images")
        .select("id, status, label_unit_id, order_line_id, production_department_id")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("delivery_date", date)
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ImageRow[];
    },
  });

  const departments = useProductionDepartments(NB_LEGAL_ENTITY_ID, false);

  /** Bare kakeprodukter hører hjemme i denne visningen. */
  const cakeUnits = useMemo(
    () =>
      (units.data ?? []).filter(
        (u) =>
          (!!u.product?.label_mode && u.product.label_mode !== "none") ||
          u.product?.cake_role === "base" ||
          u.product?.is_cake_component === true,
      ),
    [units.data],
  );

  const productIds = useMemo(
    () =>
      Array.from(
        new Set(cakeUnits.map((u) => u.product_id).filter((id): id is string => !!id)),
      ),
    [cakeUnits],
  );

  /** Avdeling for kaker uten bilde kommer fra produktets etikettprofil. */
  const productDepartments = useQuery({
    queryKey: ["cake-production", "product-departments", productIds.join(",")],
    enabled: productIds.length > 0,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from("product_label_departments")
        .select("product_id, department_id, created_at")
        .in("product_id", productIds)
        // Deterministisk rekkefølge: eldste kobling først, så alfabetisk.
        .order("created_at", { ascending: true })
        .order("department_id", { ascending: true });
      if (error) throw error;
      const out: Record<string, string> = {};
      for (const row of (data ?? []) as Array<{
        product_id: string;
        department_id: string;
      }>) {
        if (!out[row.product_id]) out[row.product_id] = row.department_id;
      }
      return out;
    },
  });

  const truncated =
    (units.data?.length ?? 0) >= 500 || (images.data?.length ?? 0) >= 500;

  const tours = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of cakeUnits) {
      if (u.order?.delivery_tour_id) {
        map.set(u.order.delivery_tour_id, u.order.delivery_tours?.name ?? "Tur");
      }
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [cakeUnits]);

  const groups = useMemo(() => {
    const byUnit = new Map<string, ImageRow>();
    const byLine = new Map<string, ImageRow>();
    for (const img of images.data ?? []) {
      if (img.label_unit_id) byUnit.set(img.label_unit_id, img);
      else if (img.order_line_id) byLine.set(img.order_line_id, img);
    }
    const deptName = new Map(
      (departments.data ?? []).map((d) => [d.id, d.display_name]),
    );

    const deptByProduct = productDepartments.data ?? {};

    const rows = cakeUnits
      .filter((u) => tour === "all" || u.order?.delivery_tour_id === tour)
      .map((u) => {
        const img =
          byUnit.get(u.id) ?? (u.order_line_id ? byLine.get(u.order_line_id) : undefined);
        const state: CakeState = img ? img.status : "mangler";
        const deptId =
          img?.production_department_id ??
          (u.product_id ? (deptByProduct[u.product_id] ?? null) : null);
        return {
          key: u.id,
          number: u.number,
          productName: u.product?.display_name ?? "Kake",
          customerName: u.order?.final_customer_name ?? null,
          orderRef: u.order?.order_number ?? null,
          tourName: u.order?.delivery_tours?.name ?? null,
          state,
          imageId: img?.id ?? null,
          deptId: deptId ?? UNSET,
          deptName: deptId ? (deptName.get(deptId) ?? "Ukjent avdeling") : "Uten avdeling",
        };
      });

    const map = new Map<string, { name: string; rows: typeof rows }>();
    for (const r of rows) {
      const g = map.get(r.deptId) ?? { name: r.deptName, rows: [] as typeof rows };
      g.rows.push(r);
      map.set(r.deptId, g);
    }
    return Array.from(map, ([id, g]) => ({ id, ...g })).sort((a, b) =>
      a.name.localeCompare(b.name, "nb"),
    );
  }, [cakeUnits, images.data, departments.data, productDepartments.data, tour]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Factory className="h-4 w-4" />
          Produksjon denne dagen
        </div>
        <Select value={tour} onValueChange={setTour}>
          <SelectTrigger className="h-9 w-[190px]">
            <SelectValue placeholder="Alle turer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle turer</SelectItem>
            {tours.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link to={`/produksjon/produksjonsplan?date=${date}`}>
            Produksjonsplanen
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Bare de 500 første kakene denne dagen vises.
          </span>
        </div>
      )}

      <QueryState
        isLoading={
          units.isLoading ||
          images.isLoading ||
          departments.isLoading ||
          productDepartments.isLoading
        }
        isError={
          units.isError || images.isError || departments.isError || productDepartments.isError
        }
        error={
          units.error ?? images.error ?? departments.error ?? productDepartments.error
        }
        scope="ordre:kakebilder:produksjon"
        onRetry={() => {
          void units.refetch();
          void images.refetch();
          void departments.refetch();
          void productDepartments.refetch();
        }}

        skeletonRows={3}
        isEmpty={groups.length === 0}
        emptyTitle="Ingen kaker registrert på denne dagen."
      >
        <div className="space-y-4">
          {groups.map((g) => {
            const counts = (["mangler", "venter", "ferdig_redigert", "skrevet_ut"] as CakeState[]).map(
              (state) => ({
                state,
                n: g.rows.filter((r) => r.state === state).length,
              }),
            );
            return (
              <div key={g.id} className="rounded-2xl border bg-card p-4">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h3 className="text-base font-semibold">{g.name}</h3>
                  <span className="text-sm text-muted-foreground">
                    {g.rows.length} kake(r)
                  </span>
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {counts
                      .filter((c) => c.n > 0)
                      .map((c) => (
                        <span
                          key={c.state}
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATE_CLASS[c.state]}`}
                        >
                          {STATE_LABEL[c.state]}: {c.n}
                        </span>
                      ))}
                  </div>
                </div>

                <ul className="mt-3 divide-y">
                  {g.rows.map((r) => (
                    <li
                      key={r.key}
                      className="flex flex-wrap items-center gap-2 py-1.5 text-sm"
                    >
                      <span className="w-12 shrink-0 font-semibold tabular-nums">
                        #{r.number}
                      </span>
                      <span className="min-w-[10rem] flex-1">{r.productName}</span>
                      <span className="min-w-[8rem] text-muted-foreground">
                        {r.customerName ?? "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.tourName ?? "Uten tur"}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${STATE_CLASS[r.state]}`}
                      >
                        {STATE_LABEL[r.state]}
                      </span>
                      {r.imageId ? (
                        <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                          <Link to={`/ordre/kakebilder/editor/${r.imageId}`}>
                            Åpne bildet
                          </Link>
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </QueryState>
    </section>
  );
}

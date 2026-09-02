import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { osloDateISO } from "@/lib/osloDate";

export type MatrixProduct = {
  id: string;
  display_number: number;
  code: string;
  display_name: string;
  sales_unit: string;
  mva_rate: number;
  unit_price: number | null;
  price_source: string;
};

export type MatrixTour = {
  id: string;
  tour_number: number;
  display_name: string;
  time_from: string;
  time_to: string;
  active_monday: boolean;
  active_tuesday: boolean;
  active_wednesday: boolean;
  active_thursday: boolean;
  active_friday: boolean;
  active_saturday: boolean;
  active_sunday: boolean;
};

export type MatrixCell = {
  order_id: string;
  order_number: string;
  order_status: string;
  delivery_date: string;
  delivery_tour_id: string;
  line_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total_incl_vat: number;
  merknad: unknown | null;
};

export type MatrixCustomer = {
  id: string;
  customer_number: string;
  display_name: string;
  allows_returns: boolean;
  delivery_address_line1: string | null;
  delivery_postal_code: string | null;
  delivery_city: string | null;
};

export type MatrixData = {
  products: MatrixProduct[];
  tours: MatrixTour[];
  existing_cells: MatrixCell[];
  customer: MatrixCustomer | null;
};

export type MatrixChange = {
  date: string;
  tour_id: string;
  product_id: string;
  quantity: number;
  /** Omit key entirely → don't touch existing merknad. null → clear. object → set. */
  merknad?: Record<string, unknown> | null;
};

export type AddableProduct = {
  id: string;
  display_number: number;
  display_name: string;
  sales_unit: string;
  unit_price: number | null;
};

export function useMatrixData(customerId: string | null, dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ["matrix", customerId, dateFrom, dateTo],
    enabled: !!customerId,
    queryFn: async (): Promise<MatrixData> => {
      const { data, error } = await supabase.rpc("get_customer_matrix_data", {
        p_customer_id: customerId!,
        p_date_from: dateFrom,
        p_date_to: dateTo,
      });
      if (error) throw error;

      const result: MatrixData = { products: [], tours: [], existing_cells: [], customer: null };
      for (const row of (data ?? []) as { section: string; payload: Record<string, unknown> }[]) {
        if (row.section === "products") result.products = (row.payload.items as MatrixProduct[]) ?? [];
        else if (row.section === "tours") result.tours = (row.payload.items as MatrixTour[]) ?? [];
        else if (row.section === "existing_cells")
          result.existing_cells = (row.payload.items as MatrixCell[]) ?? [];
        else if (row.section === "customer") result.customer = (row.payload.item as MatrixCustomer) ?? null;
      }
      return result;
    },
    staleTime: 15_000,
  });
}

export function useAddableProducts(customerId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["matrix", "addable", customerId],
    enabled: !!customerId && enabled,
    queryFn: async (): Promise<AddableProduct[]> => {
      const { data, error } = await supabase.rpc("get_addable_products", {
        p_customer_id: customerId!,
      });
      if (error) throw error;
      return (data ?? []) as AddableProduct[];
    },
    staleTime: 30_000,
  });
}

export function useSaveMatrix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { customerId: string; changes: MatrixChange[] }) => {
      const { data, error } = await supabase.rpc("save_matrix_changes", {
        p_customer_id: input.customerId,
        p_changes: input.changes as unknown as never,
      });
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["matrix"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      // Fastordre-spøkelser og utledet livssyklus endrer seg når matrisen materialiseres.
      qc.invalidateQueries({ queryKey: ["recurring-ghost"] });
      qc.invalidateQueries({ queryKey: ["orders-lifecycle"] });
    },

  });
}

/** Returns ISO weekday 1-7 (Monday=1) for a YYYY-MM-DD string */
export function isoDow(iso: string): number {
  const d = new Date(iso + "T12:00:00");
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

const DAY_KEYS: (keyof Pick<
  MatrixTour,
  | "active_monday"
  | "active_tuesday"
  | "active_wednesday"
  | "active_thursday"
  | "active_friday"
  | "active_saturday"
  | "active_sunday"
>)[] = [
  "active_monday",
  "active_tuesday",
  "active_wednesday",
  "active_thursday",
  "active_friday",
  "active_saturday",
  "active_sunday",
];

export function tourActiveOnDate(tour: MatrixTour, isoDate: string): boolean {
  return tour[DAY_KEYS[isoDow(isoDate) - 1]];
}

/** Mandag i ISO-uken som inneholder gitt dato */
export function isoWeekMonday(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  const dow = isoDow(isoDate);
  d.setDate(d.getDate() - (dow - 1));
  return osloDateISO(d);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + days);
  return osloDateISO(d);
}

export function buildWeek(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "invoice-pdfs";

/**
 * Signerer en midlertidig lenke til originalfakturaen i den private bucketen
 * `invoice-pdfs`. Lenken lagres ALDRI i databasen — den holdes kun i cache
 * så lenge den er gyldig (1 time), slik at vi ikke signerer på nytt for hver
 * fakturalinje man klikker gjennom på samme faktura.
 */
export function useInvoiceDocumentUrl(path: string | null | undefined) {
  const query = useQuery({
    queryKey: ["invoice-doc-url", path],
    enabled: !!path,
    staleTime: 50 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path!, 3600);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error("Fikk ingen signert lenke");
      return data.signedUrl;
    },
  });

  return {
    url: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

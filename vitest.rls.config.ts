import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Egen konfigurasjon for RLS-røyktestene. De kjører mot den ekte
 * Supabase-instansen og skal feile tydelig hvis konfigurasjonen mangler,
 * i stedet for å bli hoppet over.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/test/rls.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});

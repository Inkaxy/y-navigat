import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    // Rene logikk-tester (.ts) kjører i node; komponenttester (.tsx) i jsdom.
    environment: "node",
    // Komponenttester setter selv `// @vitest-environment jsdom` øverst i fila.
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // SQL-testene starter en ekte Postgres (PGlite) i en before-hook. Under full
    // parallell kjøring bruker oppstarten mer enn standardgrensen på 10 s, og
    // testene falt tilfeldig ut uten at noe var galt.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // RLS-røyktestene treffer den ekte Supabase-instansen og krever
    // konfigurasjon. De kjøres som egen jobb (`npm run test:rls`) slik at de
    // ikke kan bli stille hoppet over i den vanlige testkjøringen.
    exclude: ["node_modules/**", "dist/**", "src/test/rls.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Edge-funksjonene importerer Deno-spesifikatorer. Stubbene gjør at den
      // FAKTISKE handleren kan kjøres i vitest mot en mocket transport.
      "npm:@supabase/supabase-js@2.95.0/cors": path.resolve(__dirname, "./src/test/edge/npmSupabaseCorsStub.ts"),
      "npm:@supabase/supabase-js@2.95.0": path.resolve(__dirname, "./src/test/edge/npmSupabaseStub.ts"),
      "npm:@supabase/supabase-js@2": path.resolve(__dirname, "./src/test/edge/npmSupabaseStub.ts"),
    },
  },
});

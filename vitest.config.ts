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
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // RLS-røyktestene treffer den ekte Supabase-instansen og krever
    // konfigurasjon. De kjøres som egen jobb (`npm run test:rls`) slik at de
    // ikke kan bli stille hoppet over i den vanlige testkjøringen.
    exclude: ["node_modules/**", "dist/**", "src/test/rls.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});

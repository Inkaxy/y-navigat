import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import svgr from "vite-plugin-svgr";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), svgr({ include: "**/*.svg?react" }), mode === "development" && componentTagger()].filter(Boolean),
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) {
            // Egne chunks per app-modul slik at f.eks. embed-ruten ikke drar med hele ERP-en.
            const m = id.match(/\/src\/(varer|kunder|ordre|produksjon|pos|pos_styring|kiosk|ravarer|fakturaer|fakturering|kundeportal)\//);
            if (m) return `app-${m[1]}`;
            return undefined;
          }
          if (/react-router|history/.test(id)) return "vendor-router";
          if (/\/react-dom\/|\/react\/|scheduler/.test(id)) return "vendor-react";
          if (/@tanstack/.test(id)) return "vendor-query";
          if (/@supabase/.test(id)) return "vendor-supabase";
          if (/@react-pdf|jspdf|pdfkit|fontkit/.test(id)) return "vendor-pdf";
          if (/recharts|d3-/.test(id)) return "vendor-charts";
          if (/fabric/.test(id)) return "vendor-fabric";
          if (/xlsx|papaparse/.test(id)) return "vendor-sheets";
          if (/@tiptap|prosemirror/.test(id)) return "vendor-editor";
          if (/@radix-ui/.test(id)) return "vendor-radix";
          return "vendor";
        },
      },
    },
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: false,
        passes: 2,
      },
      format: {
        comments: false,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));

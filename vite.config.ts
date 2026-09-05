import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import svgr from "vite-plugin-svgr";
import { componentTagger } from "lovable-tagger";
import { visualizer } from "rollup-plugin-visualizer";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    svgr({ include: "**/*.svg?react" }),
    mode === "development" && componentTagger(),
    // Bundle-analyse: kjør `ANALYZE=1 npm run build` for å generere stats.html
    !!process.env.ANALYZE &&
      visualizer({ filename: "dist/stats.html", template: "raw-data", gzipSize: true }),
  ].filter(Boolean),
  build: {
    // "hidden": sourcemaps genereres, men refereres ikke fra bundlene.
    // Gir lesbare stack traces i bug_reports uten å eksponere kilden i devtools.
    sourcemap: "hidden",
    chunkSizeWarningLimit: 1200,
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

import { defineConfig, type Plugin, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import svgr from "vite-plugin-svgr";
import { componentTagger } from "lovable-tagger";
import { visualizer } from "rollup-plugin-visualizer";

// vite-plugin-svgr velger oxc-transformasjon når verten melder rolldownVersion, men «vite» i
// node_modules (v6) har ikke transformWithOxc. Skjul rolldownVersion for pluginens load slik at
// den bruker transformWithEsbuild, som finnes i Vite 6. Why: logo-SVG-ene feilet og blanket preview.
function svgrCompat(): Plugin {
  const base = svgr({ include: "**/*.svg?react" });
  const load = base.load;
  return {
    ...base,
    async load(id, opts) {
      if (typeof load !== "function") return undefined;
      const ctx: typeof this = Object.create(this, { meta: { value: { ...this.meta, rolldownVersion: undefined } } });
      const out = await load.call(ctx, id, opts);
      if (out && typeof out === "object" && "code" in out) (await import("node:fs")).writeFileSync("/tmp/svgr-last.js", String(out.code));
      // Ferdig transformert JavaScript: si det eksplisitt, ellers tolkes resultatet ut fra filendelsen.
      return out && typeof out === "object" && "code" in out ? { ...out, moduleType: "js" } : out;
    },
  };
}

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
    svgrCompat(),
    mode === "development" && componentTagger(),
    // Bundle-analyse: kjør `ANALYZE=1 npm run build` for å generere stats.html
    !!process.env.ANALYZE &&
      (visualizer({ filename: "dist/stats.html", template: "raw-data", gzipSize: true }) as PluginOption),
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

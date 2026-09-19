import { defineConfig } from "vite";
import { copyFileSync } from "node:fs";
import react from "@vitejs/plugin-react";

/**
 * SPA fallback for GitHub Pages / plain static hosts: after the build, copy
 * the built index.html to 404.html so deep links (QR scan page /paddle/:token,
 * /reset-password, /admin/...) boot the app instead of showing a 404 page.
 * Netlify (_redirects) and Vercel (vercel.json) have their own fallbacks.
 */
function spa404Fallback() {
  return {
    name: "spa-404-fallback",
    apply: "build",
    closeBundle() {
      try {
        copyFileSync("dist/index.html", "dist/404.html");
        console.log("Generated dist/404.html SPA fallback");
      } catch (err) {
        console.warn("Could not generate 404.html SPA fallback:", err.message);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), spa404Fallback()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split the big vendor libraries out of the single 548 kB monolith
          // (B26) so browser caches survive minor app changes.
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});

import { defineConfig, loadEnv } from "vite";
import { copyFileSync } from "node:fs";
import react from "@vitejs/plugin-react";

/**
 * Guard against leaking secrets into the client bundle (H2).
 * Anything prefixed VITE_ is inlined into the shipped JavaScript, so a
 * service-role key, JWT secret, or DB password under a VITE_ name would be
 * public. Fail the build loudly instead of shipping it.
 */
function assertNoClientSecrets(mode) {
  return {
    name: "assert-no-client-secrets",
    configResolved(config) {
      // config.root is the resolved project directory — no need to touch
      // `process`, which is not available in the ESLint browser env config.
      const env = loadEnv(mode, config.root, "");
      const forbidden = /(SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|PASSWD|API_KEY|ACCESS_TOKEN|DB_URL|DATABASE)/i;
      const offenders = Object.keys(env).filter(
        (key) => key.startsWith("VITE_") && forbidden.test(key),
      );
      if (offenders.length > 0) {
        throw new Error(
          `Refusing to build: these VITE_ variables look like secrets and would be shipped to the browser: ${offenders.join(
            ", ",
          )}. Remove the VITE_ prefix (server-only) or rename them.`,
        );
      }
    },
  };
}

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

export default defineConfig(({ mode }) => ({
  plugins: [react(), assertNoClientSecrets(mode), spa404Fallback()],
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
}));

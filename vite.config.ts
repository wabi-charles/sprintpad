import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { port: 5183 },
  plugins: [
    {
      // GitHub Pages has no rewrite rules, but it does serve 404.html for
      // unknown paths -- which is exactly what /happy is. Shipping the app as
      // 404.html turns that into a client-side route.
      name: "pad-routes-via-404",
      // After the HTML exists on disk, not during the bundle.
      closeBundle() {
        copyFileSync(resolve("dist/index.html"), resolve("dist/404.html"));
      },
    },
    VitePWA({
      // A list you cannot open without a network is not a list you can rely
      // on. autoUpdate so a deploy is picked up on the next load rather than
      // stranding anyone on a cached build.
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Sprintpad",
        short_name: "Sprintpad",
        description: "A keyboard-first focus notepad. Plan in seconds, focus on one thing.",
        start_url: "/",
        display: "standalone",
        background_color: "#fbfaf8",
        theme_color: "#1c1a17",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // CNAME has no extension and must not be precached.
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        // Every pad path is the same app, served from the cached shell.
        navigateFallback: "/index.html",
      },
    }),
  ],
  test: {
    // Most suites are pure logic; the wiring suites opt into a DOM with a
    // `@vitest-environment jsdom` docblock.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves project sites from /<repo>/; the workflow sets BASE_PATH.
  base: process.env.BASE_PATH || "/",
  server: {
    port: 5173,
  },
});

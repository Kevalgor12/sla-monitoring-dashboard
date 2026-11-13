import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA — builds to dist/ for Cloudflare Pages.
export default defineConfig({
  plugins: [react()],
});

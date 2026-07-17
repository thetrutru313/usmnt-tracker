import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Run the test process under a UTC-negative timezone so date-label tests
    // can distinguish the correct new Date(y, m-1, d) construction from the
    // wrong new Date(dateStr) (UTC-midnight), which shifts by one calendar day
    // for users west of UTC.
    env: { TZ: "America/New_York" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});

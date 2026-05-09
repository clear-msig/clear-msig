// Vitest configuration - keeps tests co-located with the msig library
// and wires the same `@/` path alias Next.js uses.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Co-located `__tests__` folders + `*.test.ts` siblings.
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.ts"],
    // We're testing pure-function utilities; the Node default env is
    // fast and skips the JSDOM overhead.
    environment: "node",
    reporters: "default",
  },
});

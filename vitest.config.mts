import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}", "components/**/*.tsx", "lib/**/*.ts"],
      exclude: ["app/api/**", "app/opengraph-image.tsx"],
      // ADR-0004 coverage gate for this repo.
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});

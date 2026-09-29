import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // The domain logic is pure, so it runs without a DOM. UI tests that need one
    // opt in per file with a `@vitest-environment jsdom` comment.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

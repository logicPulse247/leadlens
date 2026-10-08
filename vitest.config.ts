import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    pool: "threads",
    include: ["tests/unit/**/*.test.ts"],
    coverage: { provider: "v8", include: ["src/server/**/*.ts"] },
  },
});

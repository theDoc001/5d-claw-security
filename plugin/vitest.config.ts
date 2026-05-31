import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
    globals: false,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["index.ts", "api.ts", "src/**/*.ts"],
      exclude: ["test/**", "**/*.spec.ts"]
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});

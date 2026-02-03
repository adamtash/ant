import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/types/**"],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      "@": "/src",
      // Vite doesn't yet recognize Node's built-in `node:sqlite` in all environments.
      // Alias the stripped specifier back to the built-in so tests can import memory modules.
      sqlite: "node:sqlite",
    },
  },
  ssr: {
    external: ["node:sqlite", "sqlite"],
  },
});

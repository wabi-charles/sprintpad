import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { port: 5183 },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

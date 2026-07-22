import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: true,
    // Windows hosts can expose many CPUs while limiting child processes; cap jsdom forks to keep Tinypool stable.
    minWorkers: 1,
    maxWorkers: 4,
  },
});

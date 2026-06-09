import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Pure-logic tests (*.test.ts) run in the fast node env; component/DOM tests
// (*.test.tsx) opt into jsdom + jest-dom matchers.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});

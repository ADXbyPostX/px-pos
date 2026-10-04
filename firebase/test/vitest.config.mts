import { defineConfig } from "vitest/config";

// Rules tests run inside `firebase emulators:exec` (see root package.json "rules:test").
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

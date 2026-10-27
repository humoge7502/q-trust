import { defineConfig } from "vitest/config";

// Narrow test set for mutation testing (Stryker runs inside a sandbox; the
// cross-language fixture test reads ../sdk, which is outside that sandbox).
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "tests/certification.test.ts",
      "tests/certification-vectors.test.ts",
      "tests/certification-policy.test.ts",
      "tests/certification-structure.test.ts",
      "tests/certification-chain.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 45_000,
  },
});

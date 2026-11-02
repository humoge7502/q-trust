import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The API tests start real HTTP listeners and sometimes wait on mocked
    // chain timers. A loaded developer machine (or a parallel test run) can
    // exceed Vitest's default 5 s even though the code is correct; a model
    // training run on the same box is enough to do it. Keep the test itself
    // bounded, but do not turn CPU contention into a false bug.
    testTimeout: 30_000,
    hookTimeout: 45_000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Yalnız projenin test klasörleri; geçici kaynak kopyaları normal kapıya karışmaz.
    include: ["{apps,packages}/*/test/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.{test,spec}.{ts,tsx}"],
    // Bound concurrent media setup: unbounded workers can time out real FFmpeg fixture hooks.
    maxWorkers: 4,
    // Tam takım paralel çalışırken (özellikle --coverage ile) ağır testler 5 sn'lik varsayılanı aşabiliyordu.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
      reporter: ["text-summary", "json-summary", "html"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});

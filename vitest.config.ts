import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: [
            "test/format/**/*.test.ts",
            "test/server/**/*.test.ts",
            "test/skills/**/*.test.ts",
            "test/scripts/**/*.test.ts",
          ],
        },
      },
      {
        // The root tsconfig.json is the server's; the iframe app's JSX setting lives in
        // tsconfig.ui.json, which esbuild does not pick up for these files on its own.
        esbuild: { jsx: "automatic" },
        test: {
          name: "ui",
          environment: "happy-dom",
          include: ["test/ui/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});

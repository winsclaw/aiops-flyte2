/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/gen\/(.*)$/, replacement: `${fromRoot("./gen")}/$1` },
      { find: /^@\/types\/(.*)$/, replacement: `${fromRoot("./types")}/$1` },
      { find: /^@\/(.*)$/, replacement: `${fromRoot("./src")}/$1` },
    ],
  },
  test: {
    environment: "jsdom",
  },
});

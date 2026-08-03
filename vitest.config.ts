import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    // client/**: toistaiseksi vain lähdekoodia lukevat vartijatestit (ei
    // DOM-renderöintiä), joten ne ajavat samassa node-ympäristössä.
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "client/**/*.test.ts"],
  },
});

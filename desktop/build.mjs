// Bundles the main process and the preload script into dist/. Both are
// CommonJS: a sandboxed preload can't load ES modules.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: process.env.NODE_ENV !== "production",
  logLevel: "info",
};

await Promise.all([
  build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.js" }),
  build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.js" }),
]);

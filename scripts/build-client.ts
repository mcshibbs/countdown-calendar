import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const sourcePath = resolve(rootDir, "public", "app.ts");
const targetPath = resolve(rootDir, "public", "app.js");

const source = readFileSync(sourcePath, "utf8");
const output = stripTypeScriptTypes(source, {
  mode: "transform",
  sourceMap: false
});

writeFileSync(
  targetPath,
  `// Generated from app.ts by scripts/build-client.ts.\n${output}`,
  "utf8"
);

console.log(`Built ${targetPath}`);

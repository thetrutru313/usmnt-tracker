/**
 * Post-codegen cleanup script.
 *
 * orval's `workspace` option generates a barrel index.ts in the workspace
 * root directory by APPENDING `export *` lines on every run.  Each of the
 * two packages (api-zod, api-client-react) manually maintains its own
 * index.ts with additional hand-written exports and comments, so we must
 * strip the orval-appended lines after each codegen run.
 *
 * For api-zod we also must NOT re-export "./generated/types" — those
 * plain-TS mirrors share names with the zod validators in "./generated/api"
 * and cause TS2308 ambiguity errors.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");

/**
 * Remove lines that orval appends to a workspace index.ts.
 * Only lines that start with `export * from '` (single-quote, orval style)
 * are stripped — the hand-written lines use double-quotes, so they survive.
 */
function cleanWorkspaceIndex(relPath) {
  const absPath = resolve(root, relPath);
  const original = readFileSync(absPath, "utf8");
  const cleaned = original
    .split("\n")
    .filter((line) => !line.startsWith("export * from '"))
    .join("\n");

  if (cleaned !== original) {
    writeFileSync(absPath, cleaned, "utf8");
    console.log(`post-codegen: cleaned ${relPath}`);
  } else {
    console.log(`post-codegen: ${relPath} already clean`);
  }
}

cleanWorkspaceIndex("lib/api-zod/src/index.ts");
cleanWorkspaceIndex("lib/api-client-react/src/index.ts");

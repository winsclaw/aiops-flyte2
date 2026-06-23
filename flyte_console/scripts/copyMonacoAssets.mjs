/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const source = path.join(
  projectRoot,
  "node_modules",
  "monaco-editor",
  "min",
  "vs",
);
const targetRoot = path.join(projectRoot, "public", "monaco");
const target = path.join(targetRoot, "vs");

await rm(targetRoot, { force: true, recursive: true });
await mkdir(targetRoot, { recursive: true });
await cp(source, target, { recursive: true });

#!/usr/bin/env node
/** Monorepo-only: stage tree into packages/orb44. No-op in OrbSec/satellite. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stage = path.resolve(here, "../../scripts/stage-orb44-npm.mjs");
if (!fs.existsSync(stage)) process.exit(0);
const r = spawnSync(process.execPath, [stage], { stdio: "inherit" });
process.exit(r.status ?? 1);

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const CLI_PACKAGE = "@orb44/cli";
export const SAT_TREE_FILES = [
  "bin/orb44.mjs",
  "server/pulse.mjs",
  "server/sat-i18n.mjs",
  "server/cli-menu.mjs",
  "server/sat-local.mjs",
  "server/sat-http.mjs",
  "server/sat-update.mjs",
  "server/sat-logs.mjs",
  "server/sat-access.mjs",
  "server/sat-top.mjs",
  "package.json",
];

const REGISTRY_LATEST = "https://registry.npmjs.org/@orb44%2fcli/latest";

export function cmpVer(a, b) {
  const pa = String(a || "0").split(".").map((n) => Number(n) || 0);
  const pb = String(b || "0").split(".").map((n) => Number(n) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function looksLikeSat(root) {
  const r = path.resolve(root);
  if (!fs.existsSync(path.join(r, "bin", "orb44.mjs"))) return false;
  if (!fs.existsSync(path.join(r, "server", "pulse.mjs"))) return false;
  if (fs.existsSync(path.join(r, "server", "index.mjs"))) return false;
  return true;
}

export function readCliVersion(scriptFile) {
  const binDir = path.dirname(path.resolve(scriptFile));
  const root = path.join(binDir, "..");
  const candidates = [
    path.join(root, "package.json"),
    path.join(root, "packages", "orb44", "package.json"),
  ];
  for (const p of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      if (j.name === CLI_PACKAGE && j.version) return String(j.version);
    } catch {
      /* next */
    }
  }
  return "0.0.0";
}

/** Files the running CLI expects, plus whatever the unpacked tarball actually ships. */
export function listSatPackageFiles(srcPackageDir) {
  const src = path.resolve(srcPackageDir);
  const out = new Set(SAT_TREE_FILES);
  try {
    const j = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
    for (const f of j.files || []) out.add(String(f));
    const bin = j.bin;
    if (typeof bin === "string") out.add(bin);
    else if (bin && typeof bin === "object") {
      for (const v of Object.values(bin)) if (v) out.add(String(v));
    }
  } catch {
    /* SAT_TREE_FILES only */
  }
  const serverDir = path.join(src, "server");
  try {
    for (const name of fs.readdirSync(serverDir)) {
      if (name.endsWith(".mjs")) out.add(`server/${name}`);
    }
  } catch {
    /* no server dir */
  }
  if (fs.existsSync(path.join(src, "bin", "orb44.mjs"))) out.add("bin/orb44.mjs");
  if (fs.existsSync(path.join(src, "package.json"))) out.add("package.json");
  return [...out];
}

export function missingSatFiles(root) {
  const r = path.resolve(root);
  const miss = [];
  for (const rel of SAT_TREE_FILES) {
    if (rel === "package.json") continue;
    if (!fs.existsSync(path.join(r, rel))) miss.push(rel);
  }
  try {
    const pulse = fs.readFileSync(path.join(r, "server", "pulse.mjs"), "utf8");
    for (const m of pulse.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const spec = m[1];
      const abs = path.join(r, "server", spec);
      if (!fs.existsSync(abs)) miss.push(path.posix.join("server", path.basename(spec)));
    }
  } catch {
    miss.push("server/pulse.mjs");
  }
  return [...new Set(miss)];
}

export function treeNeedsRefresh(root, latest, { force = false } = {}) {
  if (force) return true;
  if (missingSatFiles(root).length) return true;
  const ver = readCliVersion(path.join(root, "bin", "orb44.mjs"));
  if (cmpVer(ver, latest) < 0) return true;
  try {
    const pulse = fs.readFileSync(path.join(root, "server", "pulse.mjs"), "utf8");
    if (!pulse.includes("function collapseListen")) return true;
    if (!pulse.includes("function collectApps")) return true;
    if (!fs.existsSync(path.join(root, "server", "sat-http.mjs"))) return true;
  } catch {
    return true;
  }
  return false;
}

export function staleSatRoots(roots, latest, opts = {}) {
  return (roots || []).filter((r) => treeNeedsRefresh(r, latest, opts));
}

export function pickSatRoots(scriptFile, { systemLib = "/usr/lib/orb44-sat" } = {}) {
  const here = path.resolve(path.dirname(scriptFile), "..");
  const out = [];
  if (looksLikeSat(here)) out.push(here);
  const lib = systemLib ? path.resolve(systemLib) : "";
  if (lib && looksLikeSat(lib) && !out.includes(lib)) out.push(lib);
  return out;
}

export function applyUpdateTree(srcPackageDir, destRoot) {
  const src = path.resolve(srcPackageDir);
  const dest = path.resolve(destRoot);
  for (const rel of listSatPackageFiles(src)) {
    const from = path.join(src, rel);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    fs.chmodSync(to, rel.endsWith("orb44.mjs") ? 0o755 : 0o644);
  }
  const miss = missingSatFiles(dest);
  if (miss.length) throw new Error(`incomplete tree: ${miss.join(", ")}`);
  return dest;
}

export async function fetchLatestMeta(fetchFn = fetch) {
  const r = await fetchFn(REGISTRY_LATEST, { headers: { Accept: "application/json" } });
  if (!r?.ok) throw new Error(`registry ${r?.status || "fail"}`);
  const j = await r.json();
  const version = j?.version;
  const tarball = j?.dist?.tarball;
  if (!version || !tarball) throw new Error("registry meta");
  return { version: String(version), tarball: canonicalTarballUrl(tarball) };
}

/** npm metadata uses /@scope/name/; GET of the tarball is more reliable as /@scope%2fname/. */
export function canonicalTarballUrl(url) {
  try {
    const u = new URL(String(url));
    u.pathname = u.pathname.replace(/^\/@([^/]+)\/([^/]+)\//, "/@$1%2f$2/");
    return u.href;
  } catch {
    return String(url || "");
  }
}

export async function unpackTarball(url, tmp, fetchFn = fetch, { retries = 4, delayMs = 1500 } = {}) {
  const href = canonicalTarballUrl(url);
  let last = "fail";
  let buf = null;
  for (let i = 0; i < retries; i++) {
    const r = await fetchFn(href);
    last = r?.status || "fail";
    if (r?.ok) {
      buf = Buffer.from(await r.arrayBuffer());
      break;
    }
    if (Number(last) !== 404 && Number(last) !== 429) break;
    if (i < retries - 1 && delayMs) await new Promise((ok) => setTimeout(ok, delayMs * (i + 1)));
  }
  if (!buf) throw new Error(`tarball ${last}`);
  const tgz = path.join(tmp, "pkg.tgz");
  fs.writeFileSync(tgz, buf);
  const unpack = path.join(tmp, "unpack");
  fs.mkdirSync(unpack, { recursive: true });
  const tar = spawnSync("tar", ["-xzf", tgz, "-C", unpack], { encoding: "utf8" });
  if (tar.status !== 0) throw new Error((tar.stderr || tar.stdout || "tar").trim().slice(0, 200));
  const pkg = path.join(unpack, "package");
  if (!fs.existsSync(path.join(pkg, "bin", "orb44.mjs"))) throw new Error("bad tarball");
  return pkg;
}

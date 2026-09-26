import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export const CLI_PACKAGE = "@orb44/cli";
export const SAT_TREE_FILES = [
  "bin/orb44.mjs",
  "server/pulse.mjs",
  "server/runtime-eol.mjs",
  "server/sat-i18n.mjs",
  "server/cli-menu.mjs",
  "server/sat-local.mjs",
  "server/sat-http.mjs",
  "server/sat-update.mjs",
  "server/sat-logs.mjs",
  "server/sat-access.mjs",
  "server/sat-top.mjs",
  "server/sat-backup.mjs",
  "server/checkout-disk.mjs",
  "web/inside-notes.js",
  "package.json",
];

const REGISTRY_LATEST = "https://registry.npmjs.org/@orb44%2fcli/latest";
const REGISTRY_PKG = "https://registry.npmjs.org/@orb44%2fcli";
export const GH_RELEASES_LATEST = "https://api.github.com/repos/OrbSec/satellite/releases/latest";
const GH_UA = { Accept: "application/vnd.github+json", "User-Agent": "orb44-cli" };

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

const HASH_ALGS = { sha512: "sha512", sha384: "sha384", sha256: "sha256", sha1: "sha1" };

function packumentDist(j) {
  const version = j?.version;
  const tarball = j?.dist?.tarball;
  const integrity = j?.dist?.integrity ? String(j.dist.integrity) : null;
  const shasum = j?.dist?.shasum ? String(j.dist.shasum) : null;
  if (!version || !tarball) throw new Error("registry meta");
  if (!integrity && !shasum) throw new Error("registry meta: missing integrity");
  return { version: String(version), tarball: canonicalTarballUrl(tarball), integrity, shasum };
}

export async function fetchLatestMeta(fetchFn = fetch) {
  const r = await fetchFn(REGISTRY_LATEST, { headers: { Accept: "application/json" } });
  if (!r?.ok) throw new Error(`registry ${r?.status || "fail"}`);
  return packumentDist(await r.json());
}

export async function fetchNpmVersionMeta(version, fetchFn = fetch) {
  const ver = String(version || "").replace(/^v/, "");
  const r = await fetchFn(`${REGISTRY_PKG}/${encodeURIComponent(ver)}`, { headers: { Accept: "application/json" } });
  if (!r?.ok) throw new Error(`registry ${ver} ${r?.status || "fail"}`);
  return packumentDist(await r.json());
}

export function parseSha256Sums(text) {
  const map = new Map();
  for (const line of String(text || "").split("\n")) {
    const m = /^\s*([a-fA-F0-9]{64})\s+\*?(\S+)\s*$/.exec(line);
    if (!m) continue;
    map.set(path.basename(m[2]), m[1].toLowerCase());
  }
  return map;
}

export function verifySha256(buf, hex) {
  const expected = String(hex || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("tarball sha256 missing");
  const actual = crypto.createHash("sha256").update(buf).digest("hex");
  if (actual !== expected) throw new Error("tarball sha256 mismatch");
  return true;
}

export function pickReleaseTarballName(sums, version, assetNames = []) {
  const ver = String(version || "").replace(/^v/, "");
  const hashed = [...(sums instanceof Map ? sums.keys() : [])].map((n) => path.basename(String(n)));
  const want = [`cli-${ver}.tgz`, `orb44-cli-${ver}.tgz`, `@orb44-cli-${ver}.tgz`];
  for (const n of want) if (hashed.includes(n)) return n;
  return hashed.find((n) => /\.tgz$/.test(n) || /\.tar\.gz$/.test(n)) || null;
}

export async function fetchGithubReleaseMeta(fetchFn = fetch) {
  const r = await fetchFn(GH_RELEASES_LATEST, { headers: GH_UA });
  if (!r?.ok) throw new Error(`github ${r?.status || "fail"}`);
  const j = await r.json();
  const tag = String(j?.tag_name || "").replace(/^v/, "");
  if (!tag) throw new Error("github tag");
  const assets = Array.isArray(j.assets) ? j.assets : [];
  const sums = assets.find((a) => /SHA256SUMS/i.test(String(a.name || "")));
  const tgzAssets = assets.filter((a) => /\.tgz$|\.tar\.gz$/i.test(String(a.name || "")));
  if (!sums?.browser_download_url) throw new Error("github SHA256SUMS missing");
  return {
    version: tag,
    sumsUrl: String(sums.browser_download_url),
    tarballUrls: tgzAssets.map((a) => String(a.browser_download_url)),
    assetNames: assets.map((a) => String(a.name || "")),
  };
}

/**
 * Prefer a GitHub release whose SHA256SUMS pins the tarball.
 * npm dist.integrity is transport-only (same JSON as the bytes).
 * `--npm` skips GitHub (weaker: npm account compromise is RCE on next update).
 */
export async function resolveUpdateSource({ npmOnly = false } = {}, fetchFn = fetch) {
  if (npmOnly) {
    const meta = await fetchLatestMeta(fetchFn);
    return { ...meta, sha256: null, source: "npm", signed: false };
  }
  const gh = await fetchGithubReleaseMeta(fetchFn);
  const sumsRes = await fetchFn(gh.sumsUrl, { headers: GH_UA });
  if (!sumsRes?.ok) throw new Error(`github SHA256SUMS ${sumsRes?.status || "fail"}`);
  const sums = parseSha256Sums(await sumsRes.text());
  const name = pickReleaseTarballName(sums, gh.version, gh.assetNames);
  const sha256 = name ? sums.get(name) : null;
  if (!sha256) throw new Error("github SHA256SUMS: no tarball hash");
  const ghTarball = gh.tarballUrls.find((u) => u.endsWith(`/${name}`)) || gh.tarballUrls.find((u) => u.includes(name));
  if (ghTarball) {
    return { version: gh.version, tarball: ghTarball, sha256, integrity: null, shasum: null, source: "github", signed: true };
  }
  const npm = await fetchNpmVersionMeta(gh.version, fetchFn);
  return { ...npm, sha256, source: "npm+github-sum", signed: true };
}

/** Bytes of the tarball must match npm packument dist.integrity / dist.shasum. */
export function verifyTarballIntegrity(buf, { integrity, shasum } = {}) {
  const sri = String(integrity || "");
  const dash = sri.indexOf("-");
  if (dash > 0) {
    const alg = HASH_ALGS[sri.slice(0, dash)];
    const expected = sri.slice(dash + 1);
    if (!alg || !expected) throw new Error("tarball integrity missing");
    const actual = crypto.createHash(alg).update(buf).digest("base64");
    if (actual !== expected) throw new Error("tarball integrity mismatch");
    return true;
  }
  if (shasum) {
    const actual = crypto.createHash("sha1").update(buf).digest("hex");
    if (actual !== String(shasum).toLowerCase()) throw new Error("tarball integrity mismatch");
    return true;
  }
  throw new Error("tarball integrity missing");
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

export async function unpackTarball(url, tmp, fetchFn = fetch, { retries = 4, delayMs = 1500, integrity, shasum, sha256 } = {}) {
  const href = /github\.com|githubusercontent\.com/.test(String(url || "")) ? String(url) : canonicalTarballUrl(url);
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
  if (sha256) verifySha256(buf, sha256);
  else verifyTarballIntegrity(buf, { integrity, shasum });
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

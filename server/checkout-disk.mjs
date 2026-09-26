/**
 * Checkout file on disk vs the body the buyer fetched.
 * Hash matches script_integrity_probe: first 64 KiB, whitespace collapsed, SHA-256 of that text.
 * No configs, no .env, no full-tree read.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HASH_BYTES = 65536;
const MAX_FILES = 16;
const MAX_PER_ROOT = 4;
const MAX_DEPTH = 4;
const MAX_PER_DIR = 40;
const MAX_FILE_BYTES = 2_000_000;
const SKIP_DIR = new Set([
  "node_modules",
  "vendor",
  "uploads",
  "cache",
  "wp-includes",
  ".git",
  "storage",
  "imagecache",
  "upload",
]);

/** Filename, not a substring: pay.js and checkout.min.js, not payload.js. */
export const CHECKOUT_JS_RE = /(?:^|\/)(?:checkout|cart|payments?|widgets?|orders?|pay)(?:[._-][A-Za-z0-9._-]*)?\.js$/i;

const DEFAULT_ROOTS = ["/var/www/html", "/var/www/wordpress", "/home/bitrix/www", "/usr/share/nginx/html"];

export function hashCheckoutBody(buf) {
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || "");
  const slice = raw.subarray(0, HASH_BYTES);
  if (!slice.length || slice.includes(0)) return null;
  const text = slice.toString("utf8").replace(/\s+/g, " ").slice(0, HASH_BYTES);
  if (text.trim().length < 16) return null;
  return crypto.createHash("sha256").update(text).digest("hex");
}

function nginxRootOk(p) {
  return p && !p.includes("..") && /^\/(?:var|home|usr|opt|srv)\//.test(p);
}

function nginxHostOk(h) {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/.test(h);
}

export function parseNginxRoots(text) {
  return parseNginxSites(text).map((s) => s.root);
}

/** `server_name` sitting above a `root` in the same nginx file. No full config dump. */
export function parseNginxSites(text) {
  const src = String(text || "");
  const out = [];
  const re = /(?:^|\n)\s*root\s+(\/[^;\s]+)\s*;/g;
  let m;
  while ((m = re.exec(src))) {
    const root = m[1].replace(/\/+$/, "");
    if (!nginxRootOk(root)) continue;
    const back = src.slice(Math.max(0, m.index - 800), m.index);
    const names = [...back.matchAll(/server_name\s+([^;{]+);/g)].pop();
    const hosts = [];
    if (names) {
      for (const part of names[1].trim().split(/\s+/)) {
        const h = part.toLowerCase().replace(/\.$/, "");
        if (!nginxHostOk(h) || hosts.includes(h)) continue;
        hosts.push(h);
        if (hosts.length >= 4) break;
      }
    }
    const prev = out.find((s) => s.root === root);
    if (prev) {
      for (const h of hosts) if (!prev.hosts.includes(h)) prev.hosts.push(h);
    } else {
      out.push({ root, hosts });
    }
    if (out.length >= 8) break;
  }
  return out;
}

export function sanitizeCheckoutFiles(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    if (out.length >= MAX_FILES) break;
    const p = String(row?.path || "");
    const sha = String(row?.sha256 || "").toLowerCase();
    const hostRaw = String(row?.host || "").toLowerCase().replace(/\.$/, "");
    const host = hostRaw && nginxHostOk(hostRaw) ? hostRaw : "";
    if (!/^\/[A-Za-z0-9._~/-]{1,180}$/.test(p) || p.includes("..") || !CHECKOUT_JS_RE.test(p)) continue;
    if (!/^[0-9a-f]{64}$/.test(sha)) continue;
    const key = `${host}|${p}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item = { path: p, sha256: sha };
    if (host) item.host = host;
    out.push(item);
  }
  return out;
}

function defaultNginxFiles(exists, readdir) {
  const out = [];
  for (const dir of ["/etc/nginx/sites-enabled", "/etc/nginx/conf.d"]) {
    if (!exists(dir)) continue;
    let names = [];
    try {
      names = readdir(dir).map((ent) => (typeof ent === "string" ? ent : ent.name)).filter(Boolean);
    } catch {
      continue;
    }
    for (const name of names.slice(0, 16)) {
      if (name.startsWith(".")) continue;
      out.push(path.join(dir, name));
    }
  }
  if (exists("/etc/nginx/nginx.conf")) out.push("/etc/nginx/nginx.conf");
  return out.slice(0, 20);
}

function readHead(filePath) {
  let fh;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size <= 0 || st.size > MAX_FILE_BYTES) return null;
    fh = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(HASH_BYTES);
    const n = fs.readSync(fh, buf, 0, HASH_BYTES, 0);
    return buf.subarray(0, n);
  } catch {
    return null;
  } finally {
    if (fh != null) {
      try {
        fs.closeSync(fh);
      } catch {
        /* ignore */
      }
    }
  }
}

export function collectCheckoutFiles(io = {}) {
  const exists = io.exists || fs.existsSync;
  const readdir = io.readdir || ((p) => fs.readdirSync(p, { withFileTypes: true }));
  const readText =
    io.readText ||
    ((p) => {
      try {
        return fs.readFileSync(p, "utf8").slice(0, 8192);
      } catch {
        return "";
      }
    });
  const readFile = io.readFile || readHead;
  const siteRoots = [];
  function addRoot(root, hosts) {
    const hit = siteRoots.find((s) => s.root === root);
    if (hit) {
      for (const h of hosts || []) if (!hit.hosts.includes(h) && hit.hosts.length < 4) hit.hosts.push(h);
      return;
    }
    if (siteRoots.length >= 8) return;
    siteRoots.push({ root, hosts: (hosts || []).slice(0, 4) });
  }
  const nginxFiles = io.nginxFiles || defaultNginxFiles(exists, readdir);
  for (const cfg of nginxFiles) {
    for (const site of parseNginxSites(readText(cfg))) addRoot(site.root, site.hosts);
  }
  for (const root of DEFAULT_ROOTS) addRoot(root, []);
  const found = [];
  const seen = new Set();
  for (const site of siteRoots) {
    if (found.length >= MAX_FILES) break;
    try {
      if (!exists(site.root)) continue;
    } catch {
      continue;
    }
    walk(site.root, site.root, 0, site.hosts, { n: 0 });
  }
  return found;

  function pushFile(rel, sha, hosts) {
    const names = hosts && hosts.length ? hosts : [""];
    for (const host of names) {
      if (found.length >= MAX_FILES) return;
      const key = `${host}|${rel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = { path: rel.slice(0, 180), sha256: sha };
      if (host) item.host = host;
      found.push(item);
    }
  }

  function walk(root, dir, depth, hosts, budget) {
    if (found.length >= MAX_FILES || budget.n >= MAX_PER_ROOT || depth > MAX_DEPTH) return;
    let ents = [];
    try {
      ents = readdir(dir);
    } catch {
      return;
    }
    let n = 0;
    for (const ent of ents) {
      if (found.length >= MAX_FILES || n >= MAX_PER_DIR) return;
      n += 1;
      const name = typeof ent === "string" ? ent : ent?.name;
      if (!name || name.startsWith(".") || SKIP_DIR.has(name)) continue;
      if (typeof ent !== "string" && ent.isSymbolicLink?.()) continue;
      const abs = path.join(dir, name);
      const rel = `/${path.relative(root, abs).split(path.sep).join("/")}`;
      if (!rel.startsWith("/") || rel.includes("..")) continue;
      const isDir = typeof ent === "string" ? false : Boolean(ent.isDirectory?.());
      if (isDir) {
        walk(root, abs, depth + 1, hosts, budget);
        continue;
      }
      if (!CHECKOUT_JS_RE.test(rel)) continue;
      if (budget.n >= MAX_PER_ROOT) return;
      let buf = null;
      try {
        buf = readFile(abs);
      } catch {
        continue;
      }
      const sha = hashCheckoutBody(buf);
      if (!sha) continue;
      budget.n += 1;
      pushFile(rel, sha, hosts);
    }
  }
}

export function scriptPathname(src) {
  try {
    return decodeURIComponent(new URL(src).pathname);
  } catch {
    return "";
  }
}

export function firstPartyHost(host, origin) {
  const apex = String(host || "")
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  const o = String(origin || "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!apex || !o) return false;
  return o === apex || o === `www.${apex}` || o.endsWith(`.${apex}`);
}

function diskMatch(pathname, files) {
  const exact = files.filter((f) => f.path === pathname);
  if (exact.length === 1) return exact[0];
  const suffix = files.filter((f) => f.path !== pathname && pathname.endsWith(f.path));
  if (exact.length === 0 && suffix.length === 1) return suffix[0];
  return null;
}

/**
 * @returns {{ verdict: "same"|"page"|"disk"|"split", path: string, src: string, street: string, disk: string, prevDisk: string|null }[]}
 * same — buyer and disk match (including a deploy that moved both). No finding.
 * page — disk unchanged since the previous pulse, the page body is different.
 * disk — disk file changed, the page still serves the previous disk body.
 * split — they disagree and the previous pulse does not say which side moved.
 */
function fileApplies(file, host, primaryHost) {
  if (file.host) return firstPartyHost(file.host, host);
  if (!primaryHost) return true;
  return firstPartyHost(primaryHost, host);
}

export function pairCheckoutDisk({ host, primaryHost, rows = [], files = [], prevFiles = [] } = {}) {
  const disks = sanitizeCheckoutFiles(files).filter((f) => fileApplies(f, host, primaryHost));
  const prev = new Map(sanitizeCheckoutFiles(prevFiles).filter((f) => fileApplies(f, host, primaryHost)).map((f) => [`${f.host || ""}|${f.path}`, f.sha256]));
  const hits = [];
  for (const row of rows || []) {
    const street = String(row?.sha256Full || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(street)) continue;
    if (row.status != null && Number(row.status) !== 200) continue;
    if (!firstPartyHost(host, row.origin)) continue;
    const pathname = scriptPathname(row.src);
    if (!CHECKOUT_JS_RE.test(pathname)) continue;
    const disk = diskMatch(pathname, disks);
    if (!disk) continue;
    const D0 = prev.get(`${disk.host || ""}|${disk.path}`) || null;
    let verdict = "same";
    if (street !== disk.sha256) {
      if (D0 && disk.sha256 === D0) verdict = "page";
      else if (D0 && street === D0) verdict = "disk";
      else verdict = "split";
    }
    hits.push({
      verdict,
      path: disk.path,
      src: String(row.src || "").slice(0, 180),
      street,
      disk: disk.sha256,
      prevDisk: D0,
    });
    if (hits.length >= MAX_FILES) break;
  }
  return hits;
}

/**
 * Support windows the satellite can judge from a version string.
 * Each date is the last day the vendor still ships security fixes.
 * "ending" means that day is still ahead, but inside 180 days.
 * A branch with no row stays ok until someone adds its date.
 */

const ENDING_MS = 180 * 86400000;

const PHP_UNTIL = {
  "7.4": "2022-11-28",
  "8.0": "2023-11-26",
  "8.1": "2025-12-31",
  "8.2": "2026-12-31",
  "8.3": "2027-12-31",
  "8.4": "2028-12-31",
  "8.5": "2029-12-31",
};

const NODE_UNTIL = {
  18: "2025-04-30",
  20: "2026-04-30",
  21: "2024-06-01",
  22: "2027-04-30",
  23: "2025-06-01",
  24: "2028-04-30",
  25: "2026-06-01",
  26: "2029-04-30",
};

const OPENSSL_UNTIL = {
  "1.0": "2019-12-31",
  "1.1": "2023-09-11",
  "3.0": "2026-09-07",
  "3.1": "2025-03-14",
  "3.2": "2025-11-23",
  "3.3": "2026-04-09",
  "3.4": "2026-10-22",
  "3.5": "2030-04-08",
  "3.6": "2026-11-01",
  "4.0": "2027-05-14",
};

/** Last day of free security updates. Ubuntu dates are standard support, not ESM. Debian 12 is regular support, not LTS. */
const OS_UNTIL = {
  "ubuntu:18.04": "2023-05-31",
  "ubuntu:20.04": "2025-05-31",
  "ubuntu:22.04": "2027-06-30",
  "ubuntu:24.04": "2029-06-30",
  "ubuntu:24.10": "2025-07-10",
  "ubuntu:25.04": "2026-01-15",
  "ubuntu:25.10": "2026-07-09",
  "ubuntu:26.04": "2031-05-31",
  "debian:10": "2022-09-10",
  "debian:11": "2026-08-31",
  "debian:12": "2026-07-11",
  "debian:13": "2028-08-09",
  "alpine:3.19": "2025-11-01",
  "alpine:3.20": "2026-04-01",
  "alpine:3.21": "2026-11-01",
  "alpine:3.22": "2027-05-01",
  "alpine:3.23": "2027-11-01",
  "alpine:3.24": "2028-06-01",
  "centos:7": "2024-06-30",
  "rhel:7": "2024-06-30",
  "almalinux:7": "2024-06-30",
  "rocky:7": "2024-06-30",
  "centos:8": "2029-05-31",
  "rhel:8": "2029-05-31",
  "almalinux:8": "2029-05-31",
  "rocky:8": "2029-05-31",
  "centos:9": "2032-05-31",
  "rhel:9": "2032-05-31",
  "almalinux:9": "2032-05-31",
  "rocky:9": "2032-05-31",
};

export function parseOsRelease(text) {
  const map = {};
  for (const line of String(text || "").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    map[m[1]] = m[2].replace(/^"|"$/g, "").trim();
  }
  const osId = String(map.ID || "").toLowerCase();
  const osVersion = String(map.VERSION_ID || "");
  if (!/^[a-z][a-z0-9._-]{0,19}$/.test(osId)) return null;
  if (osVersion && !/^[0-9]+(\.[0-9]+){0,2}$/.test(osVersion)) return null;
  return { osId, osVersion };
}

export function parsePhpVersion(text) {
  const m = /(?:^|\s)(\d+\.\d+)(?:\.\d+)?/.exec(String(text || "").trim());
  return m ? m[1] : null;
}

export function parseNodeMajor(text) {
  const m = /v?(\d+)\.\d+\.\d+/.exec(String(text || ""));
  return m ? m[1] : null;
}

export function parseOpenSslMinor(text) {
  const m = /OpenSSL\s+(\d+\.\d+)/i.exec(String(text || ""));
  return m ? m[1] : null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** @returns {"ok"|"ending"|"eol"} */
export function supportState(until, now = Date.now()) {
  if (!until) return "ok";
  const end = Date.parse(`${until}T23:59:59Z`);
  if (!Number.isFinite(end)) return "ok";
  const at = Number(now);
  if (!Number.isFinite(at)) return "ok";
  if (at > end) return "eol";
  if (end - at <= ENDING_MS) return "ending";
  return "ok";
}

function datedState(table, key, now, olderThan) {
  if (table[key]) return supportState(table[key], now);
  return olderThan ? "eol" : "ok";
}

function osLookup(id, version) {
  const parts = String(version || "").split(".");
  const major = parts[0] || "";
  const minor = parts[1] || "";
  if (id === "ubuntu" || id === "alpine") return `${id}:${major}.${minor}`;
  return `${id}:${major}`;
}

function osState(id, version, now) {
  const key = osLookup(id, version);
  if (OS_UNTIL[key]) return supportState(OS_UNTIL[key], now);
  const major = num(String(version || "").split(".")[0]);
  const minor = num(String(version || "").split(".")[1]);
  if (id === "ubuntu") return major != null && major < 18 ? "eol" : "ok";
  if (id === "debian") return major != null && major < 10 ? "eol" : "ok";
  if (id === "alpine") return major === 3 && minor != null && minor < 19 ? "eol" : "ok";
  if (id === "centos" || id === "rhel" || id === "almalinux" || id === "rocky") {
    return major != null && major < 7 ? "eol" : "ok";
  }
  return "ok";
}

function phpState(version, now) {
  const key = String(version || "");
  return datedState(PHP_UNTIL, key, now, num(key) != null && num(key) < 8.1);
}

function nodeState(major, now) {
  const n = num(major);
  if (n == null) return "ok";
  return datedState(NODE_UNTIL, n, now, n < 18);
}

function opensslState(minor, now) {
  const key = String(minor || "");
  return datedState(OPENSSL_UNTIL, key, now, num(key) != null && num(key) < 3);
}

const NAMES = { os: "OS", php: "PHP", node: "Node", openssl: "OpenSSL" };

/** @returns {{id:string,name:string,version:string,state:"eol"|"ending"}[]} */
export function classifyRelease(release, now = Date.now()) {
  if (!release || typeof release !== "object") return [];
  const out = [];
  if (release.osId) {
    const state = osState(release.osId, release.osVersion, now);
    if (state !== "ok") {
      out.push({
        id: "os",
        name: NAMES.os,
        version: `${release.osId} ${release.osVersion || ""}`.trim(),
        state,
      });
    }
  }
  const php = phpState(release.php, now);
  if (release.php && php !== "ok") out.push({ id: "php", name: NAMES.php, version: String(release.php), state: php });
  const node = nodeState(release.node, now);
  if (release.node && node !== "ok") out.push({ id: "node", name: NAMES.node, version: String(release.node), state: node });
  const ssl = opensslState(release.openssl, now);
  if (release.openssl && ssl !== "ok") out.push({ id: "openssl", name: NAMES.openssl, version: String(release.openssl), state: ssl });
  return out;
}

export function sanitizeRelease(raw) {
  if (!raw || typeof raw !== "object") return null;
  const parsed = parseOsRelease(`ID=${raw.osId || ""}\nVERSION_ID=${raw.osVersion || ""}\n`);
  const php = parsePhpVersion(raw.php || "");
  const node = /^\d{1,3}$/.test(String(raw.node || "")) ? String(raw.node) : parseNodeMajor(`v${raw.node || ""}.0.0`);
  const openssl = /^\d+\.\d+$/.test(String(raw.openssl || "")) ? String(raw.openssl) : parseOpenSslMinor(raw.openssl || "");
  const out = {};
  if (parsed?.osId) {
    out.osId = parsed.osId;
    if (parsed.osVersion) out.osVersion = parsed.osVersion;
  }
  if (php) out.php = php;
  if (node && num(node) != null) out.node = String(num(node));
  if (openssl) out.openssl = openssl;
  return Object.keys(out).length ? out : null;
}

export function parseAptCheck(text) {
  const m = /(\d+)\s*;\s*(\d+)/.exec(String(text || ""));
  if (!m) return null;
  const security = Number(m[2]);
  if (!Number.isInteger(security) || security < 0) return null;
  return Math.min(9999, security);
}

export function parseDnfSecurityCount(text) {
  const raw = String(text || "");
  if (/cache|error|failed|no such|metadata/i.test(raw) && !/RHSA-|ALSA-|CESA-|FEDORA-/i.test(raw)) return null;
  if (!raw.trim() || /no security updates|nothing to do|0 advisories/i.test(raw)) return 0;
  const rows = raw.split("\n").filter((line) => /RHSA-|ALSA-|CESA-|FEDORA-|security/i.test(line));
  return rows.length ? Math.min(9999, rows.length) : null;
}

export function sanitizeSecurityUpdates(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return Math.min(9999, n);
}

export function streetServerSpecs(inside, now = Date.now()) {
  const pulse = inside?.pulse;
  if (!pulse) {
    return [{ severity: "info", copyKey: "server.unseen", copyParams: {}, evidence: { satellite: false } }];
  }
  const out = [];
  const items = classifyRelease(pulse.release, now);
  if (items.length) {
    const list = items.map((i) => `${i.name} ${i.version} (${i.state})`).join(", ");
    out.push({
      severity: items.some((i) => i.state === "eol") ? "high" : "medium",
      copyKey: "host.release.eol",
      copyParams: { list },
      evidence: { release: sanitizeRelease(pulse.release), items },
    });
  }
  const pending = sanitizeSecurityUpdates(pulse.securityUpdates);
  if (pending > 0) {
    out.push({
      severity: pending >= 20 ? "high" : "medium",
      copyKey: "host.updates.pending",
      copyParams: { n: String(pending) },
      evidence: { securityUpdates: pending },
    });
  }
  return out;
}

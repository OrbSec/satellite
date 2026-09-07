import os from "node:os";
import fs from "node:fs";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { t } from "./sat-i18n.mjs";
import { collectRuntime, sanitizeErrors, sanitizeGrants, sanitizeRuntime, isSatLogNoise } from "./sat-logs.mjs";

const COMM_RE = /[^a-zA-Z0-9._+-]/g;

export function sanitizeComm(raw) {
  let s = String(raw || "").trim();
  const base = s.split("/").filter(Boolean).pop();
  if (base) s = base;
  s = s.replace(COMM_RE, "").slice(0, 40);
  return s || null;
}

export function decodeProcIp4(hex) {
  const h = String(hex || "").padStart(8, "0").slice(0, 8);
  if (!/^[0-9a-fA-F]{8}$/.test(h)) return null;
  if (h === "00000000") return "0.0.0.0";
  const b = h.match(/../g).map((x) => parseInt(x, 16));
  return `${b[3]}.${b[2]}.${b[1]}.${b[0]}`;
}

export function parseProcNetTcp(table) {
  const rows = [];
  for (const line of String(table || "").split("\n").slice(1)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 4 || p[3] !== "0A") continue;
    const [ipHex, portHex] = String(p[1] || "").split(":");
    const port = parseInt(portHex, 16);
    const addr = decodeProcIp4(ipHex);
    if (!addr || !Number.isFinite(port) || port <= 0) continue;
    rows.push({ addr, port, comm: null });
  }
  return rows;
}

function memInfo() {
  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();
  return { memTotal, memUsed };
}

function diskUsedPct(root = "/") {
  try {
    if (typeof fs.statfsSync !== "function") return null;
    const s = fs.statfsSync(root);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    if (!total) return null;
    return Math.max(0, Math.min(100, Math.round((1 - free / total) * 100)));
  } catch {
    return null;
  }
}

export function publicIpv4(ip) {
  const s = String(ip || "").replace(/^::ffff:/, "").trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return null;
  const p = s.split(".").map(Number);
  if (p.some((n) => n > 255)) return null;
  const [a, b] = p;
  if (a === 10 || a === 127 || a === 0) return null;
  if (a === 192 && b === 168) return null;
  if (a === 172 && b >= 16 && b <= 31) return null;
  if (a === 169 && b === 254) return null;
  if (a === 100 && b >= 64 && b <= 127) return null;
  return s;
}

export function pickPingTarget(pulse, seenIp) {
  const ips = [...(pulse?.originA || []), seenIp].map(publicIpv4).filter(Boolean);
  const ip = ips[0] || null;
  if (!ip) return null;
  const world = (pulse?.listen || [])
    .filter((r) => r.addr === "0.0.0.0" || r.addr === "*" || r.addr === "::")
    .map((r) => Number(r.port))
    .filter((p) => p === 443 || p === 80 || p === 22);
  const ports = [...new Set([443, 80, 22, ...world])];
  return { ip, ports };
}

export function tcpRttMs(ip, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const sock = net.connect({ host: ip, port: Number(port), timeout: timeoutMs }, () => {
      const ms = Math.max(1, Math.round(performance.now() - t0));
      sock.destroy();
      resolve(ms);
    });
    const fail = () => {
      sock.destroy();
      resolve(null);
    };
    sock.on("error", fail);
    sock.on("timeout", fail);
  });
}

export async function measureHostRtt(pulse, seenIp) {
  const target = pickPingTarget(pulse, seenIp);
  if (!target) return null;
  const hits = (
    await Promise.all(target.ports.slice(0, 3).map(async (port) => {
      const ms = await tcpRttMs(target.ip, port, 650);
      return ms == null ? null : { ms, port, ip: target.ip };
    }))
  ).filter(Boolean);
  if (!hits.length) return null;
  hits.sort((a, b) => a.ms - b.ms);
  return hits[0];
}

export function originAddrs(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const rows of Object.values(ifaces || {})) {
    for (const r of rows || []) {
      const family = String(r.family);
      if (r.internal) continue;
      if (family !== "IPv4" && family !== "4") continue;
      if (String(r.address || "").startsWith("169.254.")) continue;
      out.push(r.address);
    }
  }
  return [...new Set(out)].slice(0, 8);
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 3500, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

const SKIP_TOP = new Set(["ps", "ss", "lsof"]);

const STAT_RE = /^[DRSTZIX][A-Za-z+<]*$/;

export function parsePsTop(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)(?:\s+(\S+))?$/);
    if (!m) continue;
    let stat = null;
    let commRaw = m[4];
    if (m[5] && STAT_RE.test(m[4]) && m[4].length <= 8) {
      stat = m[4].slice(0, 4);
      commRaw = m[5];
    }
    const comm = sanitizeComm(commRaw);
    if (!comm || SKIP_TOP.has(comm)) continue;
    rows.push({
      comm,
      cpuPct: Math.round(Number(m[2]) * 10) / 10,
      rssMb: Math.round(Number(m[3]) / 1024),
      stat,
    });
  }
  rows.sort((a, b) => b.cpuPct - a.cpuPct || b.rssMb - a.rssMb);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.comm)) continue;
    seen.add(r.comm);
    out.push(r);
    if (out.length >= 8) break;
  }
  return out;
}

function splitHostPort(token) {
  const raw = String(token || "");
  const last = raw.lastIndexOf(":");
  if (last < 0) return null;
  const host = raw.slice(0, last).replace(/^\[|\]$/g, "");
  const port = Number(raw.slice(last + 1));
  if (!Number.isFinite(port) || port <= 0) return null;
  const addr = host === "*" ? "0.0.0.0" : host;
  return { addr, port };
}

export function parseLsofListen(text) {
  const rows = [];
  for (const line of String(text || "").split("\n").slice(1)) {
    const name = /\s(\S+:\d+)\s+\(LISTEN\)/.exec(line)?.[1];
    if (!name) continue;
    const hp = splitHostPort(name);
    if (!hp) continue;
    const comm = sanitizeComm(line.trim().split(/\s+/)[0]);
    rows.push({ ...hp, comm });
  }
  const key = (r) => `${r.addr}|${r.port}`;
  const uniq = new Map();
  for (const r of rows) uniq.set(key(r), r);
  return [...uniq.values()].slice(0, 40);
}

export function parseSsListen(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    if (!/\bLISTEN\b/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const idx = parts.findIndex((p) => /^LISTEN$/i.test(p));
    const local = idx >= 0 ? parts[idx + 3] : "";
    const hp = splitHostPort(local);
    if (!hp) continue;
    const comm = sanitizeComm(/\(\("([^"]+)"/.exec(line)?.[1]);
    rows.push({ ...hp, comm });
  }
  const key = (r) => `${r.addr}|${r.port}`;
  const uniq = new Map();
  for (const r of rows) uniq.set(key(r), r);
  return [...uniq.values()].slice(0, 40);
}

function listenLinux() {
  try {
    const tcp = fs.readFileSync("/proc/net/tcp", "utf8");
    return parseProcNetTcp(tcp);
  } catch {
    return [];
  }
}

function listenTable() {
  const ss = parseSsListen(run("ss", ["-lptn"]));
  if (ss.length) return { listen: ss, named: ss.some((r) => r.comm) };
  const lsof = parseLsofListen(run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]));
  if (lsof.length) return { listen: lsof, named: lsof.some((r) => r.comm) };
  const linux = listenLinux();
  if (linux.length) return { listen: linux, named: false };
  return { listen: [], named: false };
}

function topTable() {
  const withStat = run("ps", ["-axo", "pid=,pcpu=,rss=,stat=,comm="]);
  const parsed = parsePsTop(withStat);
  if (parsed.length) return parsed;
  return parsePsTop(run("ps", ["-axo", "pid=,pcpu=,rss=,comm="]));
}

function okListenAddr(a) {
  const s = String(a || "");
  if (s === "0.0.0.0" || s === "::" || s === "::1" || s === "*") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return true;
  return /^[0-9a-fA-F:]+$/.test(s) && s.includes(":");
}

export function collapseListen(rows = []) {
  const world = [];
  const rest = [];
  for (const r of rows) {
    if (r.addr === "0.0.0.0" || r.addr === "::" || r.addr === "*") world.push(r);
    else rest.push(r);
  }
  const byPort = new Map();
  for (const r of world) {
    const port = Number(r.port);
    if (!byPort.has(port)) byPort.set(port, []);
    byPort.get(port).push(r);
  }
  const out = [];
  for (const list of byPort.values()) {
    const addrs = new Set(list.map((x) => x.addr));
    const comm = list.find((x) => x.comm)?.comm || list[0].comm;
    if (addrs.has("*") || (addrs.has("0.0.0.0") && addrs.has("::"))) {
      out.push({ addr: "*", port: list[0].port, comm });
    } else {
      out.push(...list);
    }
  }
  out.push(...rest);
  return out;
}

export function sanitizePulse(raw = {}) {
  const top = Array.isArray(raw.top)
    ? raw.top
        .slice(0, 8)
        .map((r) => ({
          comm: sanitizeComm(r.comm),
          cpuPct: Math.max(0, Math.min(100, Number(r.cpuPct) || 0)),
          rssMb: Math.max(0, Math.round(Number(r.rssMb) || 0)),
          stat: STAT_RE.test(String(r.stat || "")) ? String(r.stat).slice(0, 4) : null,
        }))
        .filter((r) => r.comm)
    : [];
  const listen = collapseListen(
    Array.isArray(raw.listen)
      ? raw.listen
          .slice(0, 40)
          .map((r) => ({
            addr: String(r.addr || "").slice(0, 45),
            port: Number(r.port) || 0,
            comm: sanitizeComm(r.comm),
          }))
          .filter((r) => r.port > 0 && r.port < 65536 && okListenAddr(r.addr))
      : []
  );
  const originA = Array.isArray(raw.originA)
    ? raw.originA.map((x) => String(x || "")).filter((x) => /^\d{1,3}(\.\d{1,3}){3}$/.test(x)).slice(0, 8)
    : [];
  const fw = String(raw.hardening?.firewall || "");
  const ban = String(raw.hardening?.fail2ban || "");
  const sync = String(raw.hardening?.timesync || "");
  const tri = (v) => (v === true || v === false ? v : null);
  const hardening = {
    firewall: ["ufw", "nftables", "firewalld", "iptables"].includes(fw) ? fw : null,
    fail2ban: ["fail2ban", "sshguard"].includes(ban) ? ban : null,
    fail2banBanned: Math.max(0, Math.min(99999, Number(raw.hardening?.fail2banBanned) || 0)),
    fail2banFailed: Math.max(0, Math.min(99999, Number(raw.hardening?.fail2banFailed) || 0)),
    fail2banJails: sanitizeFail2banJails(raw.hardening?.fail2banJails),
    fail2banReadable: tri(raw.hardening?.fail2banReadable),
    updates: Boolean(raw.hardening?.updates),
    sshPassword: tri(raw.hardening?.sshPassword),
    sshRoot: tri(raw.hardening?.sshRoot),
    sshWorld: Boolean(raw.hardening?.sshWorld),
    rebootNeeded: Boolean(raw.hardening?.rebootNeeded),
    timesync: ["chrony", "systemd-timesyncd", "ntp"].includes(sync) ? sync : null,
    apparmor: tri(raw.hardening?.apparmor),
    selinux: tri(raw.hardening?.selinux),
    dockerApi: Boolean(raw.hardening?.dockerApi),
    oomKills: Math.max(0, Math.min(999, Number(raw.hardening?.oomKills) || 0)),
  };
  const limited = Boolean(raw.limited);
  const oom = Boolean(raw.oom) || hardening.oomKills > 0;
  const pressure = sanitizePressure(raw.pressure || raw);
  const cliVersion = sanitizeCliVersion(raw.cliVersion);
  const base = {
    ts: Number(raw.ts) || Date.now(),
    hostname: sanitizeComm(raw.hostname) || os.hostname().slice(0, 40),
    load1: Math.round((Number(raw.load1) || 0) * 100) / 100,
    memUsed: Math.max(0, Math.round(Number(raw.memUsed) || 0)),
    memTotal: Math.max(0, Math.round(Number(raw.memTotal) || 0)),
    diskUsedPct: raw.diskUsedPct == null ? null : Math.max(0, Math.min(100, Math.round(Number(raw.diskUsedPct)))),
    top,
    listen,
    originA,
    failedUnit: cleanFailedUnits(raw.failedUnit).join(", ") || null,
    oom,
    limited,
    hardening,
    pressure,
    cliVersion,
    grants: sanitizeGrants(raw.grants),
    runtime: sanitizeRuntime(raw.runtime),
    errors: sanitizeErrors(raw.errors),
    apps: sanitizeApps(raw.apps),
  };
  return { ...base, gradeInside: gradeInside(base) };
}

const JAIL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,40}$/;
const CMS_KINDS = new Set(["wordpress", "drupal", "bitrix", "joomla"]);
const MAIL_KINDS = new Set(["postfix", "exim", "sendmail"]);
const VPN_KINDS = new Set(["wireguard", "openvpn", "ipsec", "pptp", "l2tp"]);

function sanitizePortList(raw) {
  return [...new Set((Array.isArray(raw) ? raw : []).map((n) => Number(n)).filter((n) => n > 0 && n < 65536))].slice(0, 8);
}

function sanitizeFail2banJails(raw) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(raw) ? raw : []) {
    const name = String(row?.name || "");
    if (!JAIL_NAME_RE.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      banned: Math.max(0, Math.min(99999, Number(row.banned) || 0)),
      failed: Math.max(0, Math.min(99999, Number(row.failed) || 0)),
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function sanitizeApps(raw = {}) {
  const mail = raw?.mail;
  const vpn = raw?.vpn;
  const ssh = raw?.sshFails;
  const cms = [...new Set((Array.isArray(raw?.cms) ? raw.cms : []).map((s) => String(s).toLowerCase()).filter((s) => CMS_KINDS.has(s)))].slice(
    0,
    4
  );
  const apps = {
    cms,
    mail:
      mail && (mail.kind || mail.world || mail.queue != null || mail.openRelay != null)
        ? {
            kind: MAIL_KINDS.has(mail.kind) ? mail.kind : null,
            world: Boolean(mail.world),
            ports: sanitizePortList(mail.ports),
            queue: mail.queue == null ? null : Math.max(0, Math.min(999999, Number(mail.queue) || 0)),
            openRelay: mail.openRelay === true || mail.openRelay === false ? mail.openRelay : null,
          }
        : null,
    vpn:
      vpn && (vpn.kind || vpn.world || vpn.peers != null || (Array.isArray(vpn.ifaces) && vpn.ifaces.length))
        ? {
            kind: VPN_KINDS.has(vpn.kind) ? vpn.kind : null,
            world: Boolean(vpn.world),
            ports: sanitizePortList(vpn.ports),
            ifaces: (Array.isArray(vpn.ifaces) ? vpn.ifaces : [])
              .map((s) => String(s).replace(/[^\w.-]/g, "").slice(0, 16))
              .filter(Boolean)
              .slice(0, 6),
            peers: vpn.peers == null ? null : Math.max(0, Math.min(9999, Number(vpn.peers) || 0)),
          }
        : null,
    sshFails:
      ssh && (ssh.failed != null || ssh.invalid != null)
        ? {
            failed: Math.max(0, Math.min(99999, Number(ssh.failed) || 0)),
            invalid: Math.max(0, Math.min(99999, Number(ssh.invalid) || 0)),
            windowMin: 20,
          }
        : null,
  };
  if (!apps.cms.length && !apps.mail && !apps.vpn && !apps.sshFails) return { cms: [], mail: null, vpn: null, sshFails: null };
  return apps;
}

function sanitizeCliVersion(raw) {
  const v = String(raw || "").trim();
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}(-[a-z0-9.]+)?$/i.test(v)) return null;
  if (v === "0.0.0") return null;
  return v.slice(0, 32);
}

const ADMIN_PORTS = new Set([
  2019, 2375, 2376, 3306, 5432, 6379, 27017, 9200, 11211, 15672, 8500, 2379, 6443, 9090, 5601, 7474, 7687, 1080, 6432,
  11434, 6333, 19530, 9229, 9222,
]);

const MAIL_PORTS = new Set([25, 465, 587, 993, 995, 110, 143]);
const VPN_OK_PORTS = new Set([1194, 500, 4500, 51820]);
const VPN_WEAK_PORTS = new Set([1701, 1723]);

const SERVICE_NAME = {
  22: "SSH",
  25: "SMTP",
  53: "DNS",
  80: "HTTP",
  110: "POP3",
  143: "IMAP",
  443: "HTTPS",
  465: "SMTPS",
  500: "IKE",
  587: "Submission",
  993: "IMAPS",
  995: "POP3S",
  1080: "SOCKS",
  1194: "OpenVPN",
  1701: "L2TP",
  1723: "PPTP",
  2019: "Caddy admin",
  4500: "IPsec NAT-T",
  51820: "WireGuard",
  2375: "Docker",
  2376: "Docker TLS",
  2379: "etcd",
  3000: "Node",
  3306: "MySQL",
  5432: "Postgres",
  5601: "Kibana",
  6333: "Qdrant",
  6379: "Redis",
  6432: "PgBouncer",
  6443: "kube-api",
  7474: "Neo4j",
  7687: "Bolt",
  8500: "Consul",
  8787: "туннель",
  9090: "Prometheus",
  9200: "Elasticsearch",
  9222: "Chrome CDP",
  9229: "Node inspector",
  11211: "memcached",
  11434: "Ollama",
  15672: "RabbitMQ",
  19530: "Milvus",
  27017: "Mongo",
};

export function serviceName(port) {
  return SERVICE_NAME[Number(port)] || null;
}

function exposed(addr) {
  return addr === "0.0.0.0" || addr === "::" || addr === "*";
}

function runOk(cmd, args) {
  try {
    execFileSync(cmd, args, { encoding: "utf8", timeout: 2500, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function runOut(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 2500, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return e?.stdout ? String(e.stdout) : "";
  }
}

export function parseUfwStatus(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("status: active")) return true;
  if (t.includes("status: inactive")) return false;
  return null;
}

export function parseSshdT(text) {
  const get = (key) => {
    const re = new RegExp(`^${key}\\s+(\\S+)`, "im");
    return re.exec(String(text || ""))?.[1]?.toLowerCase() || "";
  };
  const pw = get("passwordauthentication");
  const root = get("permitrootlogin");
  return {
    sshPassword: pw === "yes" ? true : pw === "no" ? false : null,
    sshRoot: root === "yes" ? true : root ? false : null,
  };
}

export function parseVmstatOom(text) {
  const m = /(?:^|\n)oom_kill\s+(\d+)/.exec(String(text || ""));
  return m ? Number(m[1]) : 0;
}

export function parseSockstat(text) {
  const tcp = /(?:^|\n)TCP:\s+inuse\s+(\d+)(?:\s+orphan\s+(\d+))?(?:\s+tw\s+(\d+))?/i.exec(String(text || ""));
  if (!tcp) return { tcpInuse: null, tcpOrphan: null, tcpTw: null };
  return {
    tcpInuse: Number(tcp[1]),
    tcpOrphan: tcp[2] != null ? Number(tcp[2]) : null,
    tcpTw: tcp[3] != null ? Number(tcp[3]) : null,
  };
}

export function parseFileNr(text) {
  const p = String(text || "").trim().split(/[\s,]+/);
  const used = Number(p[0]);
  const max = Number(p[2] ?? p[1]);
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) return { fileUsed: null, fileMax: null, filePct: null };
  return { fileUsed: used, fileMax: max, filePct: Math.max(0, Math.min(100, Math.round((used / max) * 100))) };
}

export function parseChronyTracking(text) {
  const m =
    /Last offset\s*:\s*([+-]?\d+(?:\.\d+)?)\s*seconds/i.exec(String(text || "")) ||
    /System time\s*:\s*(\d+(?:\.\d+)?)\s*seconds\s+(slow|fast)/i.exec(String(text || ""));
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === "fast") n = Math.abs(n);
  if (m[2] === "slow") n = -Math.abs(n);
  return Math.round(n * 1000) / 1000;
}

export function parseCgroupEvents(text) {
  const kill = /(?:^|\n)oom_kill\s+(\d+)/.exec(String(text || ""));
  const oom = /(?:^|\n)oom\s+(\d+)/.exec(String(text || ""));
  return {
    cgroupOom: kill ? Number(kill[1]) : oom ? Number(oom[1]) : 0,
    memFailcnt: 0,
  };
}

export function parseNetstatListenOverflows(text) {
  const lines = String(text || "").split("\n");
  let header = "";
  let values = "";
  for (const line of lines) {
    if (/^TcpExt:\s+/.test(line) && /ListenOverflows/.test(line)) header = line;
    else if (/^TcpExt:\s+/.test(line) && header && !/ListenOverflows/.test(line)) values = line;
  }
  if (!header || !values) return { listenOverflows: null, listenDrops: null };
  const keys = header.replace(/^TcpExt:\s+/, "").trim().split(/\s+/);
  const nums = values.replace(/^TcpExt:\s+/, "").trim().split(/\s+/).map(Number);
  const idx = (name) => keys.indexOf(name);
  const n = (i) => (i >= 0 && Number.isFinite(nums[i]) ? nums[i] : null);
  return { listenOverflows: n(idx("ListenOverflows")), listenDrops: n(idx("ListenDrops")) };
}

function readTrim(p) {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return "";
  }
}

function numFile(p) {
  const n = Number(readTrim(p));
  return Number.isFinite(n) ? n : null;
}

export function stuckFromTop(top = []) {
  return (top || []).filter((r) => {
    const s = String(r.stat || "")[0];
    return s === "D" || s === "Z" || s === "T";
  }).slice(0, 6);
}

export function ramHotFloorMb(memTotal) {
  const n = Number(memTotal);
  if (!Number.isFinite(n) || n <= 0) return 1024;
  const mb = n > 10_000_000 ? n / (1024 * 1024) : n;
  return Math.max(1024, Math.round(mb * 0.3));
}

export function hotFromTop(top = [], memTotal) {
  const floor = ramHotFloorMb(memTotal);
  return (top || []).filter((r) => Number(r.cpuPct) >= 70 || Number(r.rssMb) >= floor).slice(0, 6);
}

const MINER_COMM = /^(xmrig|minerd|nbminer|t-rex|trex|ethminer|phoenixminer|lolminer|gminer|teamredminer|kdevtmpfsi|kinsing|sysupdate|networkservice)$/i;
const MINER_HEX = /^[a-f0-9]{8,32}$/i;
const LEGIT_HOT = /^(php-fpm|php|node|nodejs|java|mysqld|postgres|redis-server|nginx|caddy|apache2|httpd|python|python3|ruby|uwsgi|gunicorn|sidekiq|beanstalkd)$/i;

/** Cryptojacking heuristic: known miner names, or near-100% CPU with tiny RSS and non-legit name. */
export function looksLikeMiner(proc = {}) {
  const comm = String(proc.comm || "").replace(/^.*\//, "").slice(0, 64);
  if (!comm) return false;
  if (MINER_COMM.test(comm)) return true;
  if (LEGIT_HOT.test(comm)) return false;
  if (MINER_HEX.test(comm) && Number(proc.cpuPct) >= 90) return true;
  const cpu = Number(proc.cpuPct);
  const rss = Number(proc.rssMb);
  if (cpu >= 95 && Number.isFinite(rss) && rss > 0 && rss < 200) return true;
  return false;
}

export function minersFromTop(top = []) {
  return (top || []).filter((r) => looksLikeMiner(r)).slice(0, 4);
}

export function cpuCount(pulse) {
  const n = Number(pulse?.pressure?.cpus);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

function collectPressure() {
  const cpus = Math.max(1, os.cpus()?.length || 1);
  const sock = parseSockstat(readTrim("/proc/net/sockstat"));
  const files = parseFileNr(readTrim("/proc/sys/fs/file-nr"));
  let conntrackUsed = numFile("/proc/sys/net/netfilter/nf_conntrack_count");
  let conntrackMax = numFile("/proc/sys/net/netfilter/nf_conntrack_max");
  if (conntrackUsed == null) conntrackUsed = numFile("/proc/sys/net/nf_conntrack_count");
  if (conntrackMax == null) conntrackMax = numFile("/proc/sys/net/nf_conntrack_max");
  const conntrackPct =
    conntrackUsed != null && conntrackMax > 0 ? Math.max(0, Math.min(100, Math.round((conntrackUsed / conntrackMax) * 100))) : null;
  const overflows = parseNetstatListenOverflows(readTrim("/proc/net/netstat"));
  let clockOffsetSec = parseChronyTracking(runOut("chronyc", ["tracking"]));
  let ntpSync = null;
  if (clockOffsetSec != null) ntpSync = true;
  else {
    const td = runOut("timedatectl", ["show", "-p", "NTPSynchronized", "--value"]);
    if (/^yes$/i.test(td.trim())) ntpSync = true;
    else if (/^no$/i.test(td.trim())) ntpSync = false;
  }
  let cgroupOom = 0;
  let memFailcnt = 0;
  const ev = parseCgroupEvents(readTrim("/sys/fs/cgroup/memory.events") || readTrim("/sys/fs/cgroup/memory/memory.events"));
  cgroupOom = ev.cgroupOom || 0;
  memFailcnt = numFile("/sys/fs/cgroup/memory/memory.failcnt") ?? ev.memFailcnt ?? 0;
  return {
    cpus,
    conntrackUsed,
    conntrackMax,
    conntrackPct,
    tcpInuse: sock.tcpInuse,
    tcpTw: sock.tcpTw,
    tcpOrphan: sock.tcpOrphan,
    listenOverflows: overflows.listenOverflows,
    listenDrops: overflows.listenDrops,
    fileUsed: files.fileUsed,
    fileMax: files.fileMax,
    filePct: files.filePct,
    clockOffsetSec,
    ntpSync,
    memFailcnt: Math.max(0, Math.min(999999, Number(memFailcnt) || 0)),
    cgroupOom: Math.max(0, Math.min(999, Number(cgroupOom) || 0)),
  };
}

function sanitizePressure(raw = {}) {
  const n = (v, lo, hi) => {
    if (v == null || v === "") return null;
    const x = Number(v);
    if (!Number.isFinite(x)) return null;
    return Math.max(lo, Math.min(hi, x));
  };
  const cpus = n(raw.cpus, 1, 512) || null;
  const conntrackUsed = n(raw.conntrackUsed, 0, 1e9);
  const conntrackMax = n(raw.conntrackMax, 0, 1e9);
  const conntrackPct =
    raw.conntrackPct != null
      ? n(raw.conntrackPct, 0, 100)
      : conntrackUsed != null && conntrackMax > 0
        ? Math.max(0, Math.min(100, Math.round((conntrackUsed / conntrackMax) * 100)))
        : null;
  const clockOffsetSec = n(raw.clockOffsetSec, -86400, 86400);
  const ntpSync = raw.ntpSync === true || raw.ntpSync === false ? raw.ntpSync : null;
  return {
    cpus,
    conntrackUsed,
    conntrackMax,
    conntrackPct,
    tcpInuse: n(raw.tcpInuse, 0, 1e9),
    tcpTw: n(raw.tcpTw, 0, 1e9),
    tcpOrphan: n(raw.tcpOrphan, 0, 1e9),
    listenOverflows: n(raw.listenOverflows, 0, 1e12),
    listenDrops: n(raw.listenDrops, 0, 1e12),
    fileUsed: n(raw.fileUsed, 0, 1e12),
    fileMax: n(raw.fileMax, 0, 1e12),
    filePct: n(raw.filePct, 0, 100),
    clockOffsetSec,
    ntpSync,
    memFailcnt: n(raw.memFailcnt, 0, 1e9) || 0,
    cgroupOom: n(raw.cgroupOom, 0, 999) || 0,
  };
}

export function insideServiceWorldPorts(pulse) {
  return [...new Set((pulse?.listen || []).filter((r) => exposed(r.addr) && ADMIN_PORTS.has(r.port)).map((r) => r.port))];
}

export function collectHardening(listen = []) {
  const ufw = parseUfwStatus(runOut("ufw", ["status"]));
  let firewall = null;
  if (ufw === true) firewall = "ufw";
  else if (runOk("systemctl", ["is-active", "nftables"])) firewall = "nftables";
  else if (runOk("systemctl", ["is-active", "firewalld"])) firewall = "firewalld";
  else {
    const pol = runOut("iptables", ["-S", "INPUT"]);
    if (/^-P INPUT (DROP|REJECT)/m.test(pol)) firewall = "iptables";
  }
  let fail2ban = null;
  let fail2banBanned = 0;
  let fail2banFailed = 0;
  let fail2banJails = [];
  let fail2banReadable = null;
  if (runOk("systemctl", ["is-active", "fail2ban"])) fail2ban = "fail2ban";
  else if (runOk("systemctl", ["is-active", "sshguard"])) fail2ban = "sshguard";
  if (fail2ban === "fail2ban") {
    const got = collectFail2banJails();
    fail2banReadable = Boolean(got.readable);
    fail2banJails = got.jails || [];
    const sshd = fail2banJails.find((j) => j.name === "sshd");
    if (sshd) {
      fail2banBanned = Number(sshd.banned) || 0;
      fail2banFailed = Number(sshd.failed) || 0;
    }
  }
  const updates = runOk("systemctl", ["is-active", "unattended-upgrades"]) || fs.existsSync("/etc/apt/apt.conf.d/20auto-upgrades");
  const ssh = parseSshdT(runOut("sshd", ["-T"]) || runOut("/usr/sbin/sshd", ["-T"]));
  const sshWorld = listen.some((r) => exposed(r.addr) && r.port === 22);
  const dockerApi = listen.some((r) => exposed(r.addr) && (r.port === 2375 || r.port === 2376));
  let timesync = null;
  if (runOk("systemctl", ["is-active", "chrony"]) || runOk("systemctl", ["is-active", "chronyd"])) timesync = "chrony";
  else if (runOk("systemctl", ["is-active", "systemd-timesyncd"])) timesync = "systemd-timesyncd";
  else if (runOk("systemctl", ["is-active", "ntp"]) || runOk("systemctl", ["is-active", "ntpd"])) timesync = "ntp";
  let apparmor = null;
  if (fs.existsSync("/sys/kernel/security/apparmor")) apparmor = true;
  else if (process.platform === "linux") apparmor = false;
  let selinux = null;
  try {
    selinux = fs.readFileSync("/sys/fs/selinux/enforce", "utf8").trim() === "1";
  } catch {
    if (process.platform === "linux") selinux = false;
  }
  const rebootNeeded = fs.existsSync("/var/run/reboot-required");
  let oomKills = 0;
  try {
    oomKills = parseVmstatOom(fs.readFileSync("/proc/vmstat", "utf8"));
  } catch {
    oomKills = 0;
  }
  return {
    firewall,
    fail2ban,
    fail2banBanned,
    fail2banFailed,
    fail2banJails,
    fail2banReadable,
    updates: Boolean(updates),
    ...ssh,
    sshWorld,
    rebootNeeded,
    timesync,
    apparmor,
    selinux,
    dockerApi,
    oomKills,
  };
}

export function parseFail2banJail(text) {
  const banned = /Currently banned:\s*(\d+)/i.exec(String(text || ""));
  const failed = /Currently failed:\s*(\d+)/i.exec(String(text || ""));
  return {
    banned: banned ? Number(banned[1]) : 0,
    failed: failed ? Number(failed[1]) : 0,
  };
}

export function parseFail2banJailList(text) {
  const m = /Jail list:\s*([^\n]+)/i.exec(String(text || ""));
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => JAIL_NAME_RE.test(s))
    .slice(0, 10);
}

const FAIL2BAN_JAIL_HINT = /ssh|mail|postfix|dovecot|exim|sasl|nginx|apache|http|wordpress|recidive|named/i;

function collectFail2banJails() {
  const listText = runOut("fail2ban-client", ["status"]);
  const names = parseFail2banJailList(listText);
  if (!names.length && !/Jail list:/i.test(listText)) return { readable: false, jails: [] };
  const hinted = names.filter((n) => FAIL2BAN_JAIL_HINT.test(n));
  const pick = (hinted.length ? hinted : names).slice(0, 8);
  if (!pick.length) return { readable: true, jails: [] };
  return {
    readable: true,
    jails: pick.map((name) => ({ name, ...parseFail2banJail(runOut("fail2ban-client", ["status", name])) })),
  };
}

export function parseMailqCount(text) {
  const raw = String(text || "").trim();
  if (!raw || /mail queue is empty|no mail in queue|queue is empty/i.test(raw)) return 0;
  const req = /(?:in\s+)?(\d+)\s+Requests?/i.exec(raw);
  if (req) return Number(req[1]);
  if (/^\d+$/.test(raw.split("\n").pop().trim())) return Number(raw.split("\n").pop().trim());
  return null;
}

export function parsePostconfRelay(text) {
  const t = String(text || "");
  const line = (key) => {
    const m = new RegExp(`(?:^|\\n)${key}\\s*=\\s*([^\\n]+)`, "i").exec(t);
    return m ? m[1].trim() : "";
  };
  const nets = line("mynetworks") || t;
  if (/\b0\.0\.0\.0\/0\b|\b::\/0\b/.test(nets)) return true;
  return false;
}

export function parseWgInterfaces(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .map((s) => s.replace(/[^\w.-]/g, "").slice(0, 16))
    .filter(Boolean)
    .slice(0, 6);
}

export function parseWgPeerCount(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[0-9a-fA-F]{40,}$/.test(l)).length;
}

const CMS_PROBES = [
  ["/var/www/html/wp-includes/version.php", "wordpress"],
  ["/var/www/wordpress/wp-includes/version.php", "wordpress"],
  ["/var/www/html/wp-includes", "wordpress"],
  ["/var/www/html/core/lib/Drupal.php", "drupal"],
  ["/var/www/html/bitrix/modules", "bitrix"],
  ["/home/bitrix/www/bitrix/modules", "bitrix"],
  ["/var/www/html/administrator/manifests/files/joomla.xml", "joomla"],
];

export function inferCmsOnDisk(exists = (p) => fs.existsSync(p)) {
  const hit = new Set();
  for (const [file, kind] of CMS_PROBES) {
    try {
      if (exists(file)) hit.add(kind);
    } catch {
      /* no access */
    }
  }
  return [...hit];
}

function listenWorldPorts(listen, ports) {
  return [...new Set((listen || []).filter((r) => exposed(r.addr) && ports.has(r.port)).map((r) => r.port))];
}

function commHay(listen = [], top = []) {
  return [...listen, ...top].map((r) => String(r.comm || "").toLowerCase());
}

export function collectMail(listen = [], top = []) {
  const names = commHay(listen, top);
  const ports = listenWorldPorts(listen, MAIL_PORTS);
  const localMail = (listen || []).some((r) => MAIL_PORTS.has(r.port));
  let kind = null;
  if (runOk("systemctl", ["is-active", "postfix"]) || names.some((n) => /^(postfix|smtpd|qmgr)$/.test(n))) kind = "postfix";
  else if (runOk("systemctl", ["is-active", "exim4"]) || runOk("systemctl", ["is-active", "exim"]) || names.some((n) => /^exim/.test(n)))
    kind = "exim";
  else if (names.some((n) => /^sendmail/.test(n)) || runOk("systemctl", ["is-active", "sendmail"])) kind = "sendmail";
  else if (ports.length || localMail) kind = "postfix";
  if (!kind && !ports.length && !localMail) return null;
  let queue = null;
  if (kind === "postfix") queue = parseMailqCount(runOut("postqueue", ["-p"]) || runOut("mailq", []));
  else if (kind === "exim") queue = parseMailqCount(runOut("exim", ["-bpc"]) || runOut("exim4", ["-bpc"]));
  else if (kind === "sendmail") queue = parseMailqCount(runOut("mailq", []));
  let openRelay = null;
  if (kind === "postfix") {
    const conf = ["mynetworks", "inet_interfaces"]
      .map((k) => {
        const v = runOut("postconf", ["-h", k]).trim();
        return v ? `${k} = ${v}` : "";
      })
      .filter(Boolean)
      .join("\n");
    openRelay = conf ? parsePostconfRelay(conf) : null;
  }
  return {
    kind,
    world: ports.length > 0,
    ports,
    queue,
    openRelay,
  };
}

export function collectVpn(listen = [], top = []) {
  const names = commHay(listen, top);
  const okPorts = listenWorldPorts(listen, VPN_OK_PORTS);
  const weakPorts = listenWorldPorts(listen, VPN_WEAK_PORTS);
  const localVpn = (listen || []).some((r) => VPN_OK_PORTS.has(r.port) || VPN_WEAK_PORTS.has(r.port));
  const ifaces = parseWgInterfaces(runOut("wg", ["show", "interfaces"]));
  let peers = null;
  if (ifaces.length) {
    peers = 0;
    for (const iface of ifaces) {
      peers += parseWgPeerCount(runOut("wg", ["show", iface, "peers"]));
    }
  }
  let kind = null;
  if (ifaces.length || names.some((n) => /^wg-crypt|^wireguard/.test(n)) || okPorts.includes(51820)) kind = "wireguard";
  else if (names.some((n) => /^openvpn/.test(n)) || okPorts.includes(1194)) kind = "openvpn";
  else if (names.some((n) => /^(charon|pluto|strongswan|swanctl)$/.test(n)) || okPorts.includes(500) || okPorts.includes(4500))
    kind = "ipsec";
  else if (weakPorts.includes(1723) || names.some((n) => /^pptpd/.test(n))) kind = "pptp";
  else if (weakPorts.includes(1701) || names.some((n) => /^(xl2tpd|l2tp)/.test(n))) kind = "l2tp";
  if (!kind && !ifaces.length && !okPorts.length && !weakPorts.length && !localVpn) return null;
  return {
    kind,
    world: okPorts.length > 0 || weakPorts.length > 0,
    ports: [...okPorts, ...weakPorts],
    ifaces,
    peers,
  };
}

export function collectApps({ listen = [], top = [], sshFails = null } = {}) {
  return {
    cms: inferCmsOnDisk(),
    mail: collectMail(listen, top),
    vpn: collectVpn(listen, top),
    sshFails: sshFails || null,
  };
}

export function gradeInside(pulse = {}) {
  const listen = pulse.listen || [];
  const h = pulse.hardening || {};
  const pr = pulse.pressure || {};
  const exposedAdmin = listen.filter((r) => exposed(r.addr) && ADMIN_PORTS.has(r.port));
  const fw = Boolean(h.firewall);
  const ban = Boolean(h.fail2ban);
  const updates = Boolean(h.updates);
  const diskHigh = Number(pulse.diskUsedPct) >= 85;
  const oom = Boolean(pulse.oom) || Number(h.oomKills) > 0 || Number(pr.cgroupOom) > 0;
  const loadHigh = Number(pulse.load1) >= Math.max(2, cpuCount(pulse));
  const connHot = Number(pr.conntrackPct) >= 90;
  const stuck = stuckFromTop(pulse.top).length > 0;
  if (h.dockerApi) return "D";
  if (h.sshPassword && h.sshRoot && h.sshWorld) return "D";
  if (!fw && exposedAdmin.length) return "D";
  if (!fw && !ban) return "D";
  if (minersFromTop(pulse.top).length) return "D";
  if (exposedAdmin.length || h.sshPassword || h.sshRoot) return "C";
  if (!fw || !ban) return "C";
  if (pulse?.apps?.mail?.openRelay) return "C";
  if (diskHigh || oom || h.rebootNeeded || !h.timesync || loadHigh || connHot || stuck || pulse.failedUnit || (pulse.errors || []).some((e) => !isSatLogNoise(e?.text))) return "C";
  if (fw && ban && updates && h.timesync && !h.sshPassword && !h.sshRoot && !exposedAdmin.length && !h.dockerApi) return "A";
  if (fw && ban && !exposedAdmin.length && !h.dockerApi) return "B";
  return "C";
}

function labelPort(r) {
  const svc = serviceName(r.port);
  return svc ? `${svc} :${r.port}` : `:${r.port}`;
}

export function compareInside(pulse, rec = {}, prev = null) {
  const notes = [];
  const listen = pulse?.listen || [];
  const streetIp = rec.ticket?.ip || rec.watch?.current?.ip || null;
  const incident = rec.incident?.code || rec.watch?.current?.incident || "";
  const exposedAdmin = listen.filter((r) => exposed(r.addr) && ADMIN_PORTS.has(r.port));
  const streetOpen = rec.watch?.current?.openPorts;
  const hasStreet = Array.isArray(streetOpen);
  if (exposedAdmin.length) {
    const leaked = hasStreet ? exposedAdmin.filter((r) => streetOpen.includes(r.port)) : [];
    const held = hasStreet ? exposedAdmin.filter((r) => !streetOpen.includes(r.port)) : exposedAdmin;
    if (leaked.length) {
      const names = [...new Set(leaked.map((r) => labelPort(r)))];
      notes.push({
        kind: "listen-leaked",
        title: "Служебные порты отвечают и с улицы",
        text: `Машина слушает ${names.join(", ")} на 0.0.0.0, и снимок с интернета на тех же портах получил ответ сервиса, не пустой SYN-ACK. Это уже не «файрвол, скорее всего, держит» — сокет открыт снаружи.`,
        do: "Сначала закройте порт на файрволе панели и в docker-compose поставьте 127.0.0.1 перед номером. Orb44 файрвол сам не включает и compose не правит.",
      });
    }
    if (held.length) {
      const names = [...new Set(held.map((r) => labelPort(r)))];
      notes.push({
        kind: "listen-open",
        title: hasStreet ? "Базы слушают сеть сервера, с улицы молчат" : "Базы слушают всю сеть сервера",
        text: hasStreet
          ? `Сейчас ${names.join(", ")} принимают подключения с любого сетевого адреса этой машины. Снимок с интернета на этих портах не получил баннер сервиса — файрвол держит. Если порт откроют в панели VPS, до базы доберётся любой, не только ваш сайт.`
          : `Сейчас ${names.join(", ")} принимают подключения не только с программ на этой машине, а с любого её сетевого адреса. Из интернета их может быть не видно: файрвол на VPS эти порты, скорее всего, закрывает. Если порт откроют — до Redis или Postgres доберётся любой, не только ваш сайт.`,
        do: "На кортадо в docker-compose у этих сервисов замените порты. Пример: было 6379:6379, нужно 127.0.0.1:6379:6379. Так же для 5432, 7474 и остальных оранжевых меток. Тогда к базе подключатся только программы на этом сервере. Orb44 файл сам не изменит.",
      });
    }
  }
  if (pulse?.originA?.length && streetIp && !pulse.originA.includes(streetIp)) {
    notes.push({
      kind: "origin-mismatch",
      title: "Адрес машины не совпал со снимком",
      text: `На машине ${pulse.originA.join(", ")}, снаружи A=${streetIp}. Другой ящик или серый щит.`,
      do: "Сверьте DNS A с тем VPS, куда поставили сателлит. Если сайт за Cloudflare — это ожидаемо, не инцидент.",
    });
  }
  const loadHigh = Number(pulse?.load1) >= Math.max(2, cpuCount(pulse));
  const memHigh = pulse?.memTotal && pulse.memUsed / pulse.memTotal >= 0.85;
  const pr = pulse?.pressure || {};
  if (loadHigh || memHigh) {
    const top = pulse.top?.[0];
    const who = top ? `${top.comm} ${top.cpuPct}%` : "процесс в топе не виден";
    if (/auth_hot|auth_open/.test(incident)) {
      notes.push({
        kind: "load-street",
        title: "Нагрузка и открытый вход",
        text: `Машина под нагрузкой, снаружи открыт вход — похоже бьют во вход. Топ: ${who}.`,
        do: "Сначала вход на витрине, не процессы. Сателлит здесь только подтверждает, что CPU живой.",
      });
    } else {
      notes.push({
        kind: "load-local",
        title: "Машина тяжёлая, витрина тихая",
        text: `Нагрузка локальная, снаружи тихо — не атака витрины. Топ: ${who}.`,
        do: "Смотрите процесс в топе (воркер, docker). WAF тут ни при чём.",
      });
    }
  }
  const h = pulse.hardening || {};
  const fw = h.firewall;
  const ban = h.fail2ban;
  if (pulse.hardening) {
    if (!fw && !ban) {
      notes.push({
        kind: "hardening",
        title: "Минимум защиты не виден",
        text: "Нет включённого файрвола и нет fail2ban. Лишние порты и подбор SSH никто не режет.",
        do: "На кортадо включите ufw и fail2ban. Orb44 пакеты сам не ставит.",
      });
    } else if (!fw) {
      notes.push({
        kind: "hardening",
        title: "Файрвол не виден",
        text: "Не нашлось включённого ufw, nftables или firewalld. Тогда оранжевые порты баз — это не «закрыто файрволом», а открыто в сеть сервера.",
        do: "Включите ufw и закройте лишние порты. Orb44 файрвол сам не включает.",
      });
    } else if (!ban) {
      notes.push({
        kind: "hardening",
        title: "Нет защиты подбора SSH",
        text: "fail2ban или sshguard не запущены. Повторные попытки входа по SSH ничем не режутся.",
        do: "Поставьте и включите fail2ban на кортадо. Orb44 пакеты сам не ставит.",
      });
    }
    const sshBits = [];
    if (h.sshPassword) sshBits.push("вход по паролю включён");
    if (h.sshRoot) sshBits.push("root может зайти по SSH");
    if (h.sshWorld && (h.sshPassword || h.sshRoot)) sshBits.push("порт 22 слушает всю сеть");
    if (sshBits.length) {
      notes.push({
        kind: "hardening",
        title: "SSH слабее, чем нужно",
        text: `${sshBits.join(". ")}. Пароли не подбираем — это живые настройки sshd, не /etc/shadow.`,
        do: "В sshd: PasswordAuthentication no и PermitRootLogin no. Порт 22 лучше не светить всей сети. Orb44 sshd сам не правит.",
      });
    }
    if (h.dockerApi) {
      notes.push({
        kind: "hardening",
        title: "Docker API слушает сеть сервера",
        text: "Порт 2375 или 2376 принимает подключения не только с этой машины. С улицы его может закрывать файрвол, но сокет уже не loopback.",
        do: "Уберите публикацию Docker API наружу. Достаточно unix-сокета. Orb44 Docker сам не трогает.",
      });
    }
    if (h.rebootNeeded) {
      notes.push({
        kind: "hardening",
        title: "Ядро ждет перезагрузки",
        text: "На диске есть /var/run/reboot-required — пакеты ядра встали, машина ещё на старом.",
        do: "Запланируйте reboot в окно. Orb44 сервер сам не перезагружает.",
      });
    }
    if (!h.timesync) {
      notes.push({
        kind: "hardening",
        title: "Часы машины не синхронизируются",
        text: "Не видно chrony, systemd-timesyncd или ntp. Кривые часы ломают TLS и разбор логов.",
        do: "Включите systemd-timesyncd или chrony. Orb44 пакеты сам не ставит.",
      });
    }
    if (h.apparmor === false && h.selinux === false) {
      notes.push({
        kind: "hardening",
        title: "Нет AppArmor и SELinux",
        text: "На Linux не видно ни AppArmor, ни enforcing SELinux. Это не дыра сама по себе, но процесс ничем не ограничен.",
        do: "На Ubuntu обычно достаточно apparmor. Orb44 LSM сам не включает.",
      });
    }
    if (Number(pulse.diskUsedPct) >= 85) {
      notes.push({
        kind: "hardening",
        title: "Диск почти полный",
        text: `Корневой раздел занят на ${pulse.diskUsedPct}%. Логи и апдейты начнут падать раньше, чем витрина.`,
        do: "Почистите логи и неиспользуемые образы Docker. Orb44 файлы сам не удаляет.",
      });
    }
    if (pulse.oom || Number(h.oomKills) > 0) {
      notes.push({
        kind: "hardening",
        title: "Ядро убивало процессы по памяти",
        text: Number(h.oomKills) > 0 ? `В vmstat oom_kill=${h.oomKills}. Кто-то уже упирался в RAM.` : "Пульс пометил OOM.",
        do: "Смотрите топ по RAM и лимиты контейнеров. Orb44 процессы сам не убивает и не поднимает.",
      });
    }
    const banned = Number(h.fail2banBanned) || 0;
    if (banned > 0 && /auth_hot|auth_open/.test(incident)) {
      notes.push({
        kind: "stuffing",
        title: "fail2ban копит баны, вход с улицы горячий",
        text: `Сейчас в бане ${banned}. Пароли не подбираем — это чужой перебор, сателлит только считает.`,
        do: "Смотрите fail2ban и форму входа на витрине. Orb44 пароли не перебирает.",
      });
    }
    const jails = Array.isArray(h.fail2banJails) ? h.fail2banJails : [];
    const mailJail = jails.find((j) => /postfix|dovecot|exim|sasl/i.test(j.name) && Number(j.banned) > 0);
    if (mailJail) {
      notes.push({
        kind: "mail-bans",
        title: "fail2ban режет почтовый перебор",
        text: `Jail ${mailJail.name}: сейчас в бане ${mailJail.banned}, ещё стучатся ${mailJail.failed}. Письма не читаем и не шлём — только счётчики jail.`,
        do: "Это чужой перебор SMTP/IMAP, не рассылка с вашей очереди. Смотрите jail и SASL. Orb44 почту не трогает.",
      });
    }
  }
  const apps = pulse?.apps || {};
  const sshFails = apps.sshFails;
  if (sshFails && Number(sshFails.failed) + Number(sshFails.invalid) >= 15) {
    notes.push({
      kind: "ssh-fails",
      title: "SSH с улицы стучится",
      text: `За ${sshFails.windowMin || 20} мин в journal: Failed password ${sshFails.failed}, Invalid user ${sshFails.invalid}. IP не сохраняем.`,
      do: "Ключи вместо пароля и fail2ban на sshd. Orb44 логины не перебирает и journal наружу не выгружает.",
    });
  }
  const mail = apps.mail;
  if (mail?.openRelay) {
    notes.push({
      kind: "mail-relay",
      title: "Похоже на открытый релей",
      text: `${mail.kind || "почта"}: mynetworks содержит 0.0.0.0/0. Чужой может слать спам через этот ящик. Очередь и письма не читаем.`,
      do: "В postfix сузьте mynetworks до локальной сети и оставьте reject_unauth_destination. Orb44 postconf сам не правит.",
    });
  } else if (mail && Number(mail.queue) >= 50) {
    notes.push({
      kind: "mail-queue",
      title: "Почтовая очередь толстая",
      text: `${mail.kind || "почта"}: в очереди ${mail.queue} писем. Так бывает при рассылке или когда релей не принимает. Содержимое очереди не смотрим.`,
      do: "На машине: postqueue -p / mailq — кто отправитель. Orb44 письма не шлёт и очередь не чистит.",
    });
  } else if (mail?.world && mail.kind) {
    const hasMailJail = (h.fail2banJails || []).some((j) => /postfix|dovecot|exim|sasl/i.test(j.name));
    if (h.fail2ban && !hasMailJail) {
      notes.push({
        kind: "mail-open",
        title: "Почта слушает улицу без jail",
        text: `${mail.kind} открыт снаружи (${(mail.ports || []).join(", ") || "SMTP"}). fail2ban есть, но почтового jail не видно. Это не доказанный спам — только гигиена.`,
        do: "Добавьте jail postfix/dovecot в fail2ban. Orb44 jail сам не ставит.",
      });
    }
  }
  const vpn = apps.vpn;
  if (vpn?.kind === "pptp" || vpn?.kind === "l2tp") {
    notes.push({
      kind: "vpn-weak",
      title: "Старый VPN на машине",
      text: `${vpn.kind.toUpperCase()} слушает ${(vpn.ports || []).join(", ") || "сеть"}. Протокол слабый, ключи и конфиг не читаем.`,
      do: "Уберите PPTP/L2TP, оставьте WireGuard или OpenVPN. Orb44 VPN сам не переключает.",
    });
  }
  const stuck = stuckFromTop(pulse?.top);
  if (stuck.length) {
    const who = stuck.map((r) => `${r.comm} (${r.stat || "?"})`).join(", ");
    notes.push({
      kind: "stuck-proc",
      title: "Процессы зависли или зомби",
      text: `Состояние D/Z/T: ${who}. Так машина стоит на диске или мёртвых воркерах, а не «просто высокая нагрузка».`,
      do: "Не убивайте с кабинета — его нет. На сервере: ps и диск, не WAF. Orb44 процессы сам не трогает.",
    });
  }
  const miners = minersFromTop(pulse?.top);
  if (miners.length) {
    const who = miners.map((r) => `${r.comm} ${r.cpuPct}%`).join(", ");
    notes.push({
      kind: "crypto-miner",
      title: "Похоже на майнер",
      text: `${who}. Имя из известного списка криптомайнеров или почти 100% CPU при маленьком RSS — типичный признак чужого майнера, не «Перегруз» легитимным java.`,
      do: "На сервере остановите процесс и проверьте, как он появился (crontab, docker, скомпрометированный SSH). Orb44 процессы сам не убивает.",
    });
  }
  const hot = hotFromTop(pulse?.top, pulse?.memTotal).filter((r) => !looksLikeMiner(r));
  if (hot.length && !loadHigh) {
    const floor = ramHotFloorMb(pulse?.memTotal);
    const ramOnly = hot.every((r) => Number(r.rssMb) >= floor && Number(r.cpuPct) < 70);
    const who = hot
      .map((r) => {
        const ram = Number(r.rssMb) >= floor;
        const cpu = Number(r.cpuPct) >= 70;
        if (ram && !cpu) return `${r.comm} ${r.rssMb} МБ RAM (CPU ${r.cpuPct}%)`;
        if (cpu && !ram) return `${r.comm} CPU ${r.cpuPct}%`;
        return `${r.comm} ${r.cpuPct}%/${r.rssMb}M`;
      })
      .join(", ");
    notes.push({
      kind: "hot-proc",
      title: ramOnly ? "Процесс держит много RAM" : "Сервис жрёт CPU или RAM",
      text: ramOnly
        ? `${who}. В «Перегруз» попадает процесс из топа от ${floor} МБ RSS (30% RAM, минимум 1 ГБ). CPU тут ни при чём: load может быть спокойным.`
        : `Топ без общей перегрузки load: ${who}. Воркер уже упёрся, витрина может ещё отвечать.`,
      do: ramOnly
        ? "Это не атака и не 100% процессора. Смотрите, что за процесс и сколько ему реально нужно. Orb44 его не рестартит и память не ограничивает."
        : "Смотрите этот процесс (php-fpm, node, mysql). Orb44 его не рестартит.",
    });
  }
  if (Number(pr.conntrackPct) >= 80) {
    notes.push({
      kind: "conntrack",
      title: "Таблица соединений почти полная",
      text: `conntrack ${pr.conntrackUsed}/${pr.conntrackMax} (${pr.conntrackPct}%). Новые сессии начнут отбрасываться — с улицы это 502, изнутри это очередь.`,
      do: "Ищите кто держит кучу TCP. Не открывайте порты «чтобы помогло».",
    });
  }
  const prevPr = prev?.pressure || {};
  const overDelta =
    pr.listenOverflows != null && prevPr.listenOverflows != null
      ? Number(pr.listenOverflows) - Number(prevPr.listenOverflows)
      : 0;
  const dropDelta =
    pr.listenDrops != null && prevPr.listenDrops != null
      ? Number(pr.listenDrops) - Number(prevPr.listenDrops)
      : 0;
  if (overDelta > 0 || dropDelta > 0) {
    notes.push({
      kind: "backlog",
      title: "Очередь accept переполняется",
      text: `С прошлого пульса ListenOverflows +${overDelta}, ListenDrops +${dropDelta}. Сервис не успевает брать соединения.`,
      do: "Больше воркеров или меньше входа. Orb44 лимиты сам не поднимает.",
    });
  }
  if (Number(pr.filePct) >= 85) {
    notes.push({
      kind: "files",
      title: "Заканчиваются файловые дескрипторы",
      text: `Открыто ${pr.filePct}% лимита (${pr.fileUsed}/${pr.fileMax}). Типичный «внезапно не открывается сокет».`,
      do: "Кто держит файлы: воркер или утечка. Orb44 ulimit сам не меняет.",
    });
  }
  if (pr.clockOffsetSec != null && Math.abs(pr.clockOffsetSec) >= 5) {
    notes.push({
      kind: "clock",
      title: "Часы машины уехали",
      text: `Смещение NTP ${pr.clockOffsetSec} с. TLS и метки Watch начнут врать.`,
      do: "Почините chrony/timesyncd. Orb44 время сам не ставит.",
    });
  }
  if (Number(pr.cgroupOom) > 0 || Number(pr.memFailcnt) > 20) {
    notes.push({
      kind: "cgroup-oom",
      title: "Контейнер или cgroup упирается в память",
      text: `cgroup oom=${pr.cgroupOom || 0}, failcnt=${pr.memFailcnt || 0}. Это не journal — счётчик ядра.`,
      do: "Лимит памяти контейнера, не WAF. Orb44 лимиты сам не поднимает.",
    });
  }
  if (prev?.listen && pulse?.listen) {
    const swap = httpListenSwapped(prev, pulse);
    if (swap) {
      notes.push({
        kind: "listen-swap",
        title: "На 80/443 сменился процесс",
        text: `Было ${swap.from}, стало ${swap.to}. Бинарь витрины подменили или рядом встал другой сервер.`,
        do: "Сверьте, кто должен слушать HTTPS. Orb44 процесс сам не откатывает.",
      });
    }
  }
  const failed = cleanFailedUnits(pulse?.failedUnit);
  if (failed.length) {
    notes.push({
      kind: "failed-unit",
      title: "Упал systemd-юнит",
      text: `${failed.join(", ")} не запустился.`,
      do: "На машине: systemctl status этого юнита. Orb44 его сам не поднимает.",
    });
  }
  const errs = (pulse?.errors || []).filter((e) => !isSatLogNoise(e?.text));
  if (errs.length) {
    const line = errs
      .slice(0, 3)
      .map((e) => `${e.source} ${e.name}: ${e.text}`)
      .join(" · ");
    notes.push({
      kind: "runtime-error",
      title: "Ошибки на машине",
      text: line,
      do: "Это хвост журнала / docker / kubectl / nginx, который вы разрешили при login. Orb44 ничего не чинит.",
    });
  }
  return notes;
}

export const INSIDE_ALERT_DEBOUNCE_MS = 6 * 3600 * 1000;

function streetIncidentCode(rec = {}) {
  return rec.incident?.code || rec.watch?.current?.incident || rec.watch?.last?.incident || "";
}

function httpListenFace(p) {
  return (p?.listen || [])
    .filter((r) => Number(r.port) === 80 || Number(r.port) === 443)
    .map((r) => ({ port: Number(r.port), comm: String(r.comm || "").replace(/^\?$/, "").trim() }))
    .sort((a, b) => a.port - b.port);
}

/** True process swap on 80/443. `?` → `docker-proxy` is just ss starting to see names. */
export function httpListenSwapped(prev, pulse) {
  const a = httpListenFace(prev);
  const b = httpListenFace(pulse);
  if (!a.length || !b.length) return null;
  const label = (rows) => rows.map((r) => `${r.port}:${r.comm || "?"}`).join(",");
  const from = label(a);
  const to = label(b);
  if (from === to) return null;
  const pa = new Map(a.map((r) => [r.port, r.comm]));
  const pb = new Map(b.map((r) => [r.port, r.comm]));
  let real = false;
  for (const port of new Set([...pa.keys(), ...pb.keys()])) {
    const ca = pa.get(port) || "";
    const cb = pb.get(port) || "";
    if (ca && cb && ca !== cb) real = true;
  }
  return real ? { from, to } : null;
}

function fail2banActive(h) {
  return Boolean(h?.fail2ban);
}

/** Need fail2ban on both pulses. A default 0 on the first reading is not a brute-force spike. */
export function fail2banBanJump(pulse, prev, minJump = 10) {
  if (!fail2banActive(prev?.hardening) || !fail2banActive(pulse?.hardening)) return null;
  const banned = Number(pulse.hardening.fail2banBanned) || 0;
  const prevBanned = Number(prev.hardening.fail2banBanned) || 0;
  if (banned < prevBanned + minJump) return null;
  return { from: prevBanned, to: banned };
}

export function insideWatchReasons(pulse, prev, rec = {}) {
  const notes = [];
  const incident = String(streetIncidentCode(rec) || "");
  const streetHot = /auth_hot|auth_open|l7_exhaustion/.test(incident);
  const loadHigh = Number(pulse?.load1) >= Math.max(2, cpuCount(pulse));
  const memHigh = pulse?.memTotal && pulse.memUsed / pulse.memTotal >= 0.85;
  const top = pulse?.top?.[0];
  const who = top ? `${top.comm} ${top.cpuPct}%` : "процесс в топе не виден";
  if (loadHigh || memHigh) {
    if (streetHot) {
      notes.push({
        kind: "stuffing",
        title: "Нагрузка и открытый вход",
        text: `Машина под нагрузкой, снаружи горячий вход — похоже бьют во вход, не локальный воркер. Топ: ${who}. Пароли не подбираем.`,
      });
    } else {
      notes.push({
        kind: "load-local",
        title: "Машина тяжёлая, витрина тихая",
        text: `Нагрузка локальная, с улицы не видно атаки. Топ: ${who}.`,
      });
    }
  }
  const banJump = fail2banBanJump(pulse, prev);
  if (banJump) {
    notes.push({
      kind: "stuffing-ssh",
      title: "fail2ban копит баны SSH",
      text: `Было ${banJump.from}, стало ${banJump.to}. Чужой перебор SSH, не вход на витрину. Пароли не подбираем.`,
    });
  }
  const sshFails = pulse?.apps?.sshFails;
  if (!banJump && sshFails && Number(sshFails.failed) >= 30) {
    notes.push({
      kind: "ssh-fails",
      title: "SSH Failed password пачками",
      text: `За ${sshFails.windowMin || 20} мин Failed password ${sshFails.failed}. IP не сохраняем.`,
    });
  }
  if (pulse?.apps?.mail?.openRelay) {
    notes.push({
      kind: "mail-relay",
      title: "Открытый почтовый релей",
      text: `${pulse.apps.mail.kind || "почта"}: mynetworks 0.0.0.0/0.`,
    });
  }
  const q = Number(pulse?.apps?.mail?.queue);
  const prevQ = prev?.apps?.mail?.queue;
  if (Number.isFinite(q) && q >= 80 && (prevQ == null || q >= Number(prevQ) + 40)) {
    notes.push({
      kind: "mail-queue",
      title: "Почтовая очередь растёт",
      text: prevQ != null ? `Было ${prevQ}, стало ${q}.` : `В очереди ${q} писем.`,
    });
  }
  if (prev) {
    const nowPorts = insideServiceWorldPorts(pulse);
    const prevPorts = new Set(insideServiceWorldPorts(prev));
    const added = nowPorts.filter((p) => !prevPorts.has(p));
    if (added.length) {
      notes.push({
        kind: "listen-new",
        title: "Новый служебный порт на 0.0.0.0",
        text: `Появились ${added.join(", ")}. С прошлого пульса их не было.`,
      });
    }
    const swap = httpListenSwapped(prev, pulse);
    if (swap) {
      notes.push({
        kind: "listen-swap",
        title: "На 80/443 сменился процесс",
        text: `Было ${swap.from}, стало ${swap.to}.`,
      });
    }
  }
  const freshFailed = freshFailedUnits(pulse, prev);
  if (freshFailed.length) {
    notes.push({
      kind: "failed-unit",
      title: "Упал systemd-юнит",
      text: `${freshFailed.join(", ")} не запустился.`,
    });
  }
  /* journal/docker tails stay on the machine card — not Watch/Telegram */
  if (stuckFromTop(pulse?.top).length) {
    notes.push({
      kind: "stuck-proc",
      title: "Процессы зависли",
      text: stuckFromTop(pulse.top)
        .map((r) => `${r.comm} ${r.stat}`)
        .join(", "),
    });
  }
  if (Number(pulse?.pressure?.conntrackPct) >= 80) {
    notes.push({
      kind: "conntrack",
      title: "conntrack почти полный",
      text: `${pulse.pressure.conntrackPct}%`,
    });
  }
  const overDelta =
    pulse?.pressure?.listenOverflows != null && prev?.pressure?.listenOverflows != null
      ? Number(pulse.pressure.listenOverflows) - Number(prev.pressure.listenOverflows)
      : 0;
  const dropDelta =
    pulse?.pressure?.listenDrops != null && prev?.pressure?.listenDrops != null
      ? Number(pulse.pressure.listenDrops) - Number(prev.pressure.listenDrops)
      : 0;
  if (overDelta > 0 || dropDelta > 0) {
    notes.push({
      kind: "backlog",
      title: "Очередь accept растёт",
      text: `+${overDelta} overflows, +${dropDelta} drops с прошлого пульса.`,
    });
  }
  const streetIp = rec.ticket?.ip || rec.watch?.current?.ip || rec.watch?.last?.ip || null;
  if (pulse?.originA?.length && streetIp && !pulse.originA.includes(streetIp)) {
    notes.push({
      kind: "origin-mismatch",
      title: "Адрес машины не совпал со снимком",
      text: `На машине ${pulse.originA.join(", ")}, снаружи A=${streetIp}.`,
    });
  }
  return notes;
}

export function insideAlertDecision(row, reasons, now = Date.now(), debounceMs = INSIDE_ALERT_DEBOUNCE_MS) {
  if (!reasons?.length) return { emit: false, key: null };
  const key = [...new Set(reasons.map((r) => r.kind))].sort().join(",");
  if (row?.lastInsideAlertKey === key && row?.lastInsideAlertAt && now - row.lastInsideAlertAt < debounceMs) {
    return { emit: false, key };
  }
  return { emit: true, key };
}

/** First-boot / image leftovers that stay in `systemctl --failed` forever. Not a live outage. */
export function isNoisyFailedUnit(name) {
  const n = String(name || "").toLowerCase();
  if (/^cloud-(init|config|final)/.test(n)) return true;
  if (/^snapd\.(seeded|autoimport)/.test(n)) return true;
  if (/^systemd-networkd-wait-online/.test(n)) return true;
  if (/^(plymouth|kmod-static-nodes|finalrd|open-iscsi|iscsid)\./.test(n)) return true;
  return false;
}

export function failedUnitList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function cleanFailedUnits(raw) {
  const out = [];
  for (const name of failedUnitList(raw)) {
    const one = name.slice(0, 60);
    if (!one || isNoisyFailedUnit(one) || out.includes(one)) continue;
    out.push(one);
    if (out.length >= 6) break;
  }
  return out;
}

function freshFailedUnits(pulse, prev) {
  const now = cleanFailedUnits(pulse?.failedUnit);
  const old = new Set(cleanFailedUnits(prev?.failedUnit));
  return now.filter((u) => !old.has(u));
}

export function parseFailedUnits(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const hit = line.match(/\b([a-zA-Z0-9@._-]+\.(service|socket|mount|timer))\b/);
    if (hit && !out.includes(hit[1])) out.push(hit[1].slice(0, 60));
    if (out.length >= 8) break;
  }
  return cleanFailedUnits(out.join(", "));
}

function collectFailedUnits() {
  try {
    const out = execFileSync("systemctl", ["--failed", "--no-legend", "--no-pager", "--plain"], {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseFailedUnits(out);
  } catch {
    return [];
  }
}

export function collectPulse(opts = {}) {
  const { memUsed, memTotal } = memInfo();
  const { listen, named } = listenTable();
  const top = topTable();
  const hardening = collectHardening(listen);
  const limited = listen.length > 0 && !named;
  const pressure = collectPressure();
  const grants = sanitizeGrants(opts.grants);
  const extra = collectRuntime({ listen, top, grants });
  const apps = collectApps({ listen, top, sshFails: extra.sshFails });
  return sanitizePulse({
    ts: Date.now(),
    hostname: os.hostname(),
    load1: os.loadavg()[0],
    memUsed,
    memTotal,
    diskUsedPct: diskUsedPct("/"),
    top,
    listen,
    originA: originAddrs(),
    failedUnit: collectFailedUnits().join(", ") || null,
    oom: Number(hardening.oomKills) > 0 || Number(pressure.cgroupOom) > 0,
    limited,
    hardening,
    pressure,
    grants,
    runtime: extra.runtime,
    errors: extra.errors,
    apps,
  });
}

function clip(s, n) {
  const t = String(s ?? "");
  if (t.length <= n) return t;
  return `${t.slice(0, Math.max(1, n - 1))}…`;
}

function asciiTable(headers, rows) {
  const cells = [headers, ...rows].map((r) => r.map((c) => String(c ?? "")));
  const widths = headers.map((_, i) => Math.max(1, ...cells.map((r) => [...(r[i] || "")].length)));
  const fill = (ch) => widths.map((w) => ch.repeat(w + 2)).join("┼");
  const line = (row) =>
    "│ " +
    row
      .map((c, i) => {
        const s = clip(c, widths[i]);
        return s + " ".repeat(Math.max(0, widths[i] - [...s].length));
      })
      .join(" │ ") +
    " │";
  return [`┌${fill("─").replaceAll("┼", "┬")}┐`, line(headers), `├${fill("─")}┤`, ...rows.map(line), `└${fill("─").replaceAll("┼", "┴")}┘`].join("\n");
}

export function formatPulsePreview(pulse, lang = "en") {
  const gb = (n) => (Number(n) / 1024 / 1024 / 1024).toFixed(1);
  const none = t(lang, "preview_none");
  const h = pulse.hardening || {};
  const grade = pulse.gradeInside || gradeInside(pulse) || "—";
  const ssh = h.sshPassword ? t(lang, "preview_ssh_pass") : h.sshPassword === false ? t(lang, "preview_ssh_key") : "—";
  const machine = asciiTable(
    [t(lang, "preview_col_check"), t(lang, "preview_col_value")],
    [
      [t(lang, "preview_row_host"), pulse.hostname || "—"],
      [t(lang, "preview_row_load"), Number(pulse.load1).toFixed(2)],
      [t(lang, "preview_row_ram"), `${gb(pulse.memUsed)} / ${gb(pulse.memTotal)}`],
      [t(lang, "preview_row_disk"), `${pulse.diskUsedPct ?? "—"}%`],
      [t(lang, "preview_row_grade"), grade],
    ]
  );
  const listenRows = collapseListen([...(pulse.listen || [])])
    .sort((a, b) => {
      const rank = (addr) =>
        addr === "0.0.0.0" || addr === "::" || addr === "*" ? 0 : String(addr).startsWith("127.") || addr === "::1" ? 2 : 1;
      return rank(a.addr) - rank(b.addr) || Number(a.port) - Number(b.port);
    })
    .slice(0, 16)
    .map((r) => [r.addr || "—", String(r.port ?? ""), r.comm || "—"]);
  const listen = asciiTable(
    [t(lang, "preview_col_bind"), t(lang, "preview_col_port"), t(lang, "preview_col_proc")],
    listenRows.length ? listenRows : [[none, "", ""]]
  );
  const topRows = (pulse.top || []).slice(0, 6).map((r) => [r.comm || "—", `${r.cpuPct}%`, `${r.rssMb}M`]);
  const top = asciiTable(
    [t(lang, "preview_col_proc"), t(lang, "preview_col_cpu"), t(lang, "preview_col_rss")],
    topRows.length ? topRows : [[none, "", ""]]
  );
  const guard = asciiTable(
    [t(lang, "preview_col_check"), t(lang, "preview_col_value")],
    [
      [t(lang, "preview_row_fw"), h.firewall || t(lang, "preview_fw_no")],
      [t(lang, "preview_row_ban"), h.fail2ban || t(lang, "preview_ban_no")],
      [t(lang, "preview_row_upd"), h.updates ? t(lang, "preview_yes") : t(lang, "preview_no")],
      [t(lang, "preview_row_sync"), h.timesync || t(lang, "preview_no")],
      [t(lang, "preview_row_ssh"), ssh],
    ]
  );
  const extraBits = [];
  if (pulse.limited) extraBits.push(t(lang, "preview_limited"));
  const stuck = stuckFromTop(pulse.top);
  if (stuck.length) extraBits.push(`D/Z/T ${stuck.map((r) => `${r.comm}:${r.stat}`).join(" ")}`);
  const pr = pulse.pressure || {};
  if (pr.conntrackPct != null) extraBits.push(`conntrack ${pr.conntrackPct}%`);
  if (pr.cpus) extraBits.push(`${pr.cpus} CPU`);
  if (pulse.grants?.logs) extraBits.push("logs");
  if (pulse.grants?.daemon) extraBits.push("daemon");
  const rt = pulse.runtime || {};
  for (const k of ["docker", "kube", "nginx"]) {
    if (rt[k] === "ok") extraBits.push(k);
    if (rt[k] === "denied") extraBits.push(`${k} denied`);
  }
  if ((pulse.errors || []).length) extraBits.push(`errors ${(pulse.errors || []).length}`);
  const extra = extraBits.length ? `\n${extraBits.join(" · ")}` : "";
  return `${machine}\n\n${listen}\n\n${top}\n\n${guard}${extra}`;
}

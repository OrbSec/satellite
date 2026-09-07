import fs from "node:fs";
import { execFileSync } from "node:child_process";

const SECRET_RE = /(password|passwd|secret|api[_-]?key|authorization|bearer|private[_-]?key|token)\s*[:=]/i;
const RUNTIME_STATES = new Set(["ok", "absent", "denied"]);
const ERROR_SOURCES = new Set(["journal", "docker", "kube", "nginx", "unit"]);

export function sanitizeGrants(raw = {}) {
  return {
    process: true,
    daemon: Boolean(raw?.daemon),
    logs: Boolean(raw?.logs),
  };
}

function oneState(v) {
  return RUNTIME_STATES.has(v) ? v : "absent";
}

export function sanitizeRuntime(raw = {}) {
  return {
    daemon: oneState(raw.daemon),
    journal: oneState(raw.journal),
    docker: oneState(raw.docker),
    kube: oneState(raw.kube),
    nginx: oneState(raw.nginx),
  };
}

export function isSatLogNoise(text) {
  return /kex_exchange_identification|banner exchange|maxstartups|оборвали на рукопожатии|типичный шум/i.test(
    String(text || "")
  );
}

export function classifySatErrorText(text) {
  const s = String(text || "");
  if (isSatLogNoise(s)) {
    return {
      kind: "ssh-kex",
      text: "SSH оборвали на рукопожатии — типичный шум (fail2ban, MaxStartups или баннер). Это не ошибка сайта.",
    };
  }
  return { kind: null, text: s };
}

export function redactLogLine(line) {
  let s = String(line || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (SECRET_RE.test(s) || /-----BEGIN/.test(s)) return "[redacted]";
  if (s.length > 160) s = `${s.slice(0, 159)}…`;
  return s;
}

export function sanitizeErrors(list) {
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(list) ? list : []) {
    const source = ERROR_SOURCES.has(e?.source) ? e.source : null;
    if (isSatLogNoise(e?.text)) continue;
    const classified = classifySatErrorText(e?.text);
    const text = classified.kind ? classified.text : redactLogLine(e?.text);
    const name = classified.kind === "ssh-kex"
      ? "sshd"
      : String(e?.name || "")
          .replace(/[^\w./:@-]/g, "")
          .slice(0, 48);
    if (!source || !text || text === "[redacted]") continue;
    const key = classified.kind ? `${source}:${classified.kind}` : `${source}:${name}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source,
      name: name || source,
      level: classified.kind === "ssh-kex" ? "warn" : e.level === "warn" ? "warn" : "error",
      text,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function inferRuntime(listen = [], top = []) {
  const names = [...listen, ...top].map((r) => String(r.comm || "").toLowerCase());
  const ports = listen.map((r) => Number(r.port));
  const has = (re) => names.some((n) => re.test(n));
  return {
    docker: has(/^(dockerd|containerd|docker-proxy)/) || ports.includes(2375) || ports.includes(2376) ? "ok" : "absent",
    kube: has(/^(kubelet|kube-apiserver|k3s|k0s)$/) || ports.includes(6443) || ports.includes(10250) ? "ok" : "absent",
    nginx: has(/^(nginx|httpd|apache2|caddy|openresty)$/) ? "ok" : "absent",
  };
}

export function parseDockerPs(text) {
  const bad = [];
  for (const line of String(text || "").split("\n")) {
    const tab = line.indexOf("\t");
    const name = (tab >= 0 ? line.slice(0, tab) : line).trim();
    const status = (tab >= 0 ? line.slice(tab + 1) : "").trim();
    if (!name) continue;
    if (/restarting|unhealthy|dead|exited \((?!0\))|oom/i.test(status)) {
      bad.push({ name, status });
    }
  }
  return bad;
}

export function parseKubePods(text) {
  const bad = [];
  for (const line of String(text || "").split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [ns, name, ready, status] = parts;
    if (/^(NAMESPACE|NAME)$/i.test(ns)) continue;
    const notReady = /^0\/[1-9]/.test(ready);
    if (/CrashLoop|Error|ImagePull|BackOff|OOMKilled|Evicted|Unknown|Failed|Terminating/i.test(status) || notReady) {
      bad.push({ name: `${ns}/${name}`, text: status });
    }
  }
  return bad.slice(0, 8);
}

export function parseNginxErrorLog(text) {
  const out = [];
  for (const line of String(text || "").split("\n").reverse()) {
    if (!/\[(error|crit|alert|emerg)\]|emerg|fatal/i.test(line)) continue;
    const t = redactLogLine(line);
    if (t && t !== "[redacted]") out.push(t);
    if (out.length >= 4) break;
  }
  return out;
}

export function parseJournalErrors(text) {
  return String(text || "")
    .split("\n")
    .map(redactLogLine)
    .filter((l) => l && l !== "[redacted]" && !/orb44/i.test(l))
    .slice(0, 6);
}

function tryCmd(bin, args, timeout = 1600) {
  try {
    const out = execFileSync(bin, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: 48 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, text: String(out || "") };
  } catch (e) {
    if (e?.code === "ENOENT") return { absent: true };
    const msg = `${e?.stderr || ""} ${e?.message || ""} ${e?.stdout || ""}`;
    if (/permission denied|access denied|cannot connect|connect: permission|forbidden|unauthorized|dial unix|Got permission/i.test(msg)) {
      return { denied: true };
    }
    if (/localhost:8080 was refused|no configuration|no such file|The connection to the server/i.test(msg)) {
      return { absent: true };
    }
    if (e?.stdout) return { ok: true, text: String(e.stdout) };
    return { fail: true };
  }
}

function probeDaemon() {
  const sys = tryCmd("systemctl", ["is-active", "orb44-satellite"]);
  if (sys.ok && String(sys.text).trim() === "active") return "ok";
  const user = tryCmd("systemctl", ["--user", "is-active", "orb44-satellite"]);
  if (user.ok && String(user.text).trim() === "active") return "ok";
  return "absent";
}

function collectJournal() {
  const r = tryCmd("journalctl", ["-p", "err", "-n", "12", "--no-pager", "--output=cat"]);
  if (r.absent) return { state: "absent", errors: [] };
  if (r.denied) return { state: "denied", errors: [] };
  if (!r.ok) return { state: "absent", errors: [] };
  return {
    state: "ok",
    errors: parseJournalErrors(r.text).map((text) => ({ source: "journal", name: "journal", text })),
  };
}

function collectDocker() {
  const sock = "/var/run/docker.sock";
  const sockHere = fs.existsSync(sock);
  const ps = tryCmd("docker", ["ps", "-a", "--format", "{{.Names}}\t{{.Status}}"]);
  if (ps.absent && !sockHere) return { state: "absent", errors: [] };
  if (ps.denied || (ps.absent && sockHere)) return { state: "denied", errors: [] };
  if (!ps.ok) return { state: sockHere ? "denied" : "absent", errors: [] };
  const errors = [];
  for (const c of parseDockerPs(ps.text).slice(0, 4)) {
    const logs = tryCmd("docker", ["logs", "--tail", "10", "--since", "20m", c.name], 1800);
    const lines = String(logs.text || "")
      .split("\n")
      .map(redactLogLine)
      .filter((l) => l && l !== "[redacted]" && /error|fatal|panic|oom|emerg/i.test(l));
    errors.push({
      source: "docker",
      name: c.name,
      text: lines[0] || c.status,
    });
  }
  return { state: "ok", errors };
}

function collectKube() {
  const pods = tryCmd("kubectl", ["get", "pods", "-A", "--no-headers"], 2000);
  if (pods.absent) return { state: "absent", errors: [] };
  if (pods.denied) return { state: "denied", errors: [] };
  if (!pods.ok) return { state: "absent", errors: [] };
  return {
    state: "ok",
    errors: parseKubePods(pods.text).map((p) => ({ source: "kube", name: p.name, text: p.text })),
  };
}

const WEB_LOGS = ["/var/log/nginx/error.log", "/var/log/httpd/error_log", "/var/log/apache2/error.log", "/var/log/caddy/error.log"];

function tailFile(file, max = 8192) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(Math.min(max, st.size));
    fs.readSync(fd, buf, 0, buf.length, Math.max(0, st.size - max));
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function collectNginx() {
  let denied = false;
  let saw = false;
  const errors = [];
  for (const file of WEB_LOGS) {
    if (!fs.existsSync(file)) continue;
    saw = true;
    try {
      const lines = parseNginxErrorLog(tailFile(file));
      for (const text of lines) errors.push({ source: "nginx", name: file.split("/").slice(-2).join("/"), text });
    } catch {
      denied = true;
    }
  }
  if (errors.length) return { state: "ok", errors };
  if (denied) return { state: "denied", errors: [] };
  if (saw) return { state: "ok", errors: [] };
  return { state: "absent", errors: [] };
}

function pickState(probed, inferred) {
  if (probed && probed !== "absent") return probed;
  return inferred || "absent";
}

export function parseSshAuthFails(text) {
  let failed = 0;
  let invalid = 0;
  for (const line of String(text || "").split("\n")) {
    if (/Failed password|authentication failure|Failed keyboard-interactive/i.test(line)) failed += 1;
    else if (/Invalid user|Failed none/i.test(line)) invalid += 1;
  }
  return { failed, invalid };
}

function collectSshFails() {
  const since = ["--since", "20 min ago", "--no-pager", "-o", "cat", "-q"];
  let r = tryCmd("journalctl", ["-u", "sshd", ...since]);
  if (!r.ok || !(r.text || "").trim()) r = tryCmd("journalctl", ["-u", "ssh", ...since]);
  if (r.denied || r.absent || !r.ok) return null;
  const c = parseSshAuthFails(r.text);
  return { failed: c.failed, invalid: c.invalid, windowMin: 20 };
}

export function collectRuntime({ listen = [], top = [], grants } = {}) {
  const g = sanitizeGrants(grants);
  const inferred = inferRuntime(listen, top);
  const daemon = probeDaemon();
  if (!g.logs) {
    return {
      runtime: sanitizeRuntime({ ...inferred, daemon, journal: "absent" }),
      errors: [],
      sshFails: null,
    };
  }
  const journal = collectJournal();
  const docker = collectDocker();
  const kube = collectKube();
  const nginx = collectNginx();
  return {
    runtime: sanitizeRuntime({
      daemon,
      journal: journal.state,
      docker: pickState(docker.state, inferred.docker),
      kube: pickState(kube.state, inferred.kube),
      nginx: pickState(nginx.state, inferred.nginx),
    }),
    errors: sanitizeErrors([...journal.errors, ...docker.errors, ...kube.errors, ...nginx.errors]),
    sshFails: collectSshFails(),
  };
}

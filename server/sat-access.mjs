import fs from "node:fs";
import { spawnSync } from "node:child_process";

export const FAIL2BAN_SOCK = "/var/run/fail2ban/fail2ban.sock";
export const DOCKER_SOCK = "/var/run/docker.sock";
export const FAIL2BAN_DROPIN_DIR = "/etc/systemd/system/fail2ban.service.d";
export const FAIL2BAN_DROPIN = `${FAIL2BAN_DROPIN_DIR}/orb44-acl.conf`;

const WEB_LOG_DIRS = ["/var/log/nginx", "/var/log/apache2", "/var/log/httpd", "/var/log/caddy"];

function run(cmd, args = [], opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

export function cmdExists(bin, spawn = run) {
  const r = spawn("sh", ["-c", `command -v ${bin}`]);
  return r.status === 0 && Boolean(String(r.stdout || "").trim());
}

export function groupExists(name, spawn = run) {
  if (!name) return false;
  return spawn("getent", ["group", String(name)]).status === 0;
}

export function unitActive(name, spawn = run) {
  return spawn("systemctl", ["is-active", name]).status === 0;
}

/** What can be useful on this box (probe only — no changes). */
export function probeAccessTargets({ exists = fs.existsSync, spawn = run } = {}) {
  const docker = Boolean(exists(DOCKER_SOCK) || cmdExists("docker", spawn));
  const fail2ban = unitActive("fail2ban", spawn) || exists(FAIL2BAN_SOCK);
  const journal = cmdExists("journalctl", spawn);
  const webLogs = WEB_LOG_DIRS.some((d) => exists(d));
  return { docker, fail2ban, journal, webLogs };
}

export function normalizeAccess(raw = {}) {
  return {
    fail2ban: Boolean(raw.fail2ban),
    docker: Boolean(raw.docker),
    journal: Boolean(raw.journal),
  };
}

/** Groups to put on the systemd unit (only those that exist). */
export function supplementaryGroups(access, { spawn = run } = {}) {
  const a = normalizeAccess(access);
  const want = [];
  if (a.docker) want.push("docker");
  if (a.journal) want.push("systemd-journal", "adm");
  return want.filter((g) => groupExists(g, spawn));
}

export function fail2banDropInBody(user = "orb44") {
  const u = String(user || "orb44").replace(/[^\w.-]/g, "") || "orb44";
  return `[Service]
# Orb44 satellite: read ACL on fail2ban socket (no sudo at runtime).
ExecStartPost=/bin/sh -c "for i in 1 2 3 4 5 6 8 10; do setfacl -m u:${u}:rw /var/run/fail2ban/fail2ban.sock 2>/dev/null && exit 0; setfacl -m u:${u}:rw /run/fail2ban/fail2ban.sock 2>/dev/null && exit 0; sleep 1; done; exit 0"
`;
}

function note(ok, key, detail = "") {
  return { ok: Boolean(ok), key, detail: String(detail || "").slice(0, 200) };
}

function ensureInGroup(user, group, spawn) {
  if (!groupExists(group, spawn)) return note(false, "group_missing", group);
  const id = spawn("id", ["-nG", user]);
  const groups = String(id.stdout || "").trim().split(/\s+/);
  if (groups.includes(group)) return note(true, "group_already", group);
  const r = spawn("usermod", ["-aG", group, user]);
  if (r.status !== 0) return note(false, "group_fail", (r.stderr || r.stdout || group).trim());
  return note(true, "group_added", group);
}

/** Detect host package manager and how to install packages (root only). */
export function detectPkgInstaller(spawn = run) {
  const rows = [
    { bin: "apt-get", args: (pkgs) => ["install", "-y", ...pkgs], env: { DEBIAN_FRONTEND: "noninteractive" } },
    { bin: "dnf", args: (pkgs) => ["install", "-y", ...pkgs] },
    { bin: "yum", args: (pkgs) => ["install", "-y", ...pkgs] },
    { bin: "apk", args: (pkgs) => ["add", "--no-cache", ...pkgs] },
    { bin: "zypper", args: (pkgs) => ["--non-interactive", "install", ...pkgs] },
  ];
  return rows.find((r) => cmdExists(r.bin, spawn)) || null;
}

/**
 * Ensure setfacl exists. With install=true (default), install package `acl` when the user
 * already consented to fail2ban/journal ACL access and we are applying as root.
 */
export function ensureSetfacl({ spawn = run, install = true } = {}) {
  if (cmdExists("setfacl", spawn)) return note(true, "setfacl_ok", "setfacl");
  if (!install) return note(false, "setfacl_missing", "acl");
  const installer = detectPkgInstaller(spawn);
  if (!installer) return note(false, "pkg_mgr_unknown", "acl");
  const opts = installer.env ? { env: { ...process.env, ...installer.env } } : {};
  const r = spawn(installer.bin, installer.args(["acl"]), opts);
  if (r.status !== 0) {
    return note(false, "pkg_install_fail", `${installer.bin} acl: ${(r.stderr || r.stdout || "").trim()}`);
  }
  if (!cmdExists("setfacl", spawn)) return note(false, "pkg_install_fail", "acl installed but setfacl still missing");
  return note(true, "pkg_installed", "acl");
}

function aclOnPath(user, target, spawn) {
  if (!cmdExists("setfacl", spawn)) return note(false, "setfacl_missing", target);
  if (!fs.existsSync(target)) return note(false, "path_missing", target);
  const r = spawn("setfacl", ["-m", `u:${user}:rwX`, target]);
  if (r.status !== 0) return note(false, "acl_fail", (r.stderr || target).trim());
  return note(true, "acl_ok", target);
}

function writeFail2banDropIn(user, { mkdir, write, spawn } = {}) {
  const mk = mkdir || ((p, o) => fs.mkdirSync(p, o));
  const wr = write || ((p, b, o) => fs.writeFileSync(p, b, o));
  const sp = spawn || run;
  try {
    mk(FAIL2BAN_DROPIN_DIR, { recursive: true, mode: 0o755 });
    wr(FAIL2BAN_DROPIN, fail2banDropInBody(user), { mode: 0o644 });
  } catch (e) {
    return note(false, "dropin_fail", e.message || e);
  }
  if (unitActive("fail2ban", sp)) {
    sp("systemctl", ["daemon-reload"]);
    const r = sp("systemctl", ["restart", "fail2ban"]);
    if (r.status !== 0) return note(false, "fail2ban_restart_fail", (r.stderr || "").trim());
  }
  return note(true, "dropin_ok", FAIL2BAN_DROPIN);
}

/**
 * Apply read access for service user. Safe to call only as root.
 * Does not grant write/mutate on Docker beyond what the docker group already allows on the host.
 * When fail2ban/journal ACL is needed and setfacl is missing, installs package `acl` (installPkgs, default true).
 */
export function applySatelliteAccess(user, access, deps = {}) {
  const a = normalizeAccess(access);
  const spawn = deps.spawn || run;
  const notes = [];
  const u = String(user || "orb44").replace(/[^\w.-]/g, "") || "orb44";
  const needAcl = a.fail2ban || a.journal;
  const installPkgs = deps.installPkgs !== false;

  if (needAcl) notes.push(ensureSetfacl({ spawn, install: installPkgs }));
  const haveAcl = cmdExists("setfacl", spawn);

  if (a.docker) notes.push(ensureInGroup(u, "docker", spawn));
  if (a.journal) {
    notes.push(ensureInGroup(u, "systemd-journal", spawn));
    notes.push(ensureInGroup(u, "adm", spawn));
    if (haveAcl) {
      for (const dir of WEB_LOG_DIRS) {
        if (fs.existsSync(dir)) notes.push(aclOnPath(u, dir, spawn));
      }
    }
  }
  if (a.fail2ban) {
    notes.push(writeFail2banDropIn(u, deps));
    if (haveAcl) {
      for (const sock of [FAIL2BAN_SOCK, "/run/fail2ban/fail2ban.sock"]) {
        if (fs.existsSync(sock)) notes.push(aclOnPath(u, sock, spawn));
      }
    }
  }
  return {
    ok: notes.every((n) => n.ok || n.key === "group_missing" || n.key === "path_missing"),
    notes,
  };
}

export function accessManualHints(user, access, { spawn = run } = {}) {
  const a = normalizeAccess(access);
  const u = user || "orb44";
  const lines = [];
  if ((a.fail2ban || a.journal) && !cmdExists("setfacl", spawn)) {
    const inst = detectPkgInstaller(spawn);
    if (inst?.bin === "apt-get") lines.push("apt-get install -y acl");
    else if (inst?.bin === "dnf") lines.push("dnf install -y acl");
    else if (inst?.bin === "yum") lines.push("yum install -y acl");
    else if (inst?.bin === "apk") lines.push("apk add acl");
    else if (inst?.bin === "zypper") lines.push("zypper install -y acl");
    else lines.push("install package acl (setfacl) via your package manager");
  }
  if (a.docker) lines.push(`usermod -aG docker ${u}`);
  if (a.journal) lines.push(`usermod -aG systemd-journal,adm ${u}`);
  if (a.fail2ban) {
    lines.push(`mkdir -p ${FAIL2BAN_DROPIN_DIR}`);
    lines.push(`# drop-in → ${FAIL2BAN_DROPIN} then: systemctl daemon-reload && systemctl restart fail2ban`);
    lines.push(`setfacl -m u:${u}:rw ${FAIL2BAN_SOCK}`);
  }
  return lines;
}

const DOCKER_SOCK_PATHS = [DOCKER_SOCK, "/run/docker.sock"];
const DOCKER_GROUP_USER = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/;
const DOCKER_GROUP_EXPECTED = new Set(["root", "orb44"]);

/** Unix permission bits from fs.Stats.mode — world-write is the root-equivalent misconfig. */
export function parseStatMode(mode) {
  const perm = Number(mode) & 0o777;
  return {
    mode: perm.toString(8).padStart(3, "0"),
    worldWrite: Boolean(perm & 0o002),
    worldRead: Boolean(perm & 0o004),
  };
}

/** `getent group docker` → usernames already in the group (safe-read, no usermod). */
export function parseGetentGroupMembers(text) {
  const line = String(text || "").trim().split("\n")[0];
  if (!line.includes(":")) return [];
  const members = (line.split(":")[3] || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => DOCKER_GROUP_USER.test(s));
  return [...new Set(members)].slice(0, 12);
}

export function unexpectedDockerGroup(members = []) {
  return (Array.isArray(members) ? members : []).filter((m) => !DOCKER_GROUP_EXPECTED.has(String(m)));
}

/**
 * World-writable docker.sock and current docker-group members.
 * Probe only — does not chmod, usermod, or talk to the Docker API.
 */
export function probeDockerSocket({ exists = fs.existsSync, stat = (p) => fs.statSync(p), spawn = run } = {}) {
  const sockPath = DOCKER_SOCK_PATHS.find((p) => exists(p));
  let dockerSockMode = null;
  let dockerSockWorld = false;
  if (sockPath) {
    try {
      const parsed = parseStatMode(stat(sockPath).mode);
      dockerSockMode = parsed.mode;
      dockerSockWorld = parsed.worldWrite;
    } catch {
      /* sock vanished between exists and stat */
    }
  }
  const g = spawn("getent", ["group", "docker"]);
  const dockerGroup = g.status === 0 ? parseGetentGroupMembers(g.stdout) : [];
  return { dockerSockMode, dockerSockWorld, dockerGroup };
}

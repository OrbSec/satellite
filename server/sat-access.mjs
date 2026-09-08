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
 */
export function applySatelliteAccess(user, access, deps = {}) {
  const a = normalizeAccess(access);
  const spawn = deps.spawn || run;
  const notes = [];
  const u = String(user || "orb44").replace(/[^\w.-]/g, "") || "orb44";

  if (a.docker) notes.push(ensureInGroup(u, "docker", spawn));
  if (a.journal) {
    notes.push(ensureInGroup(u, "systemd-journal", spawn));
    notes.push(ensureInGroup(u, "adm", spawn));
    for (const dir of WEB_LOG_DIRS) {
      if (fs.existsSync(dir)) notes.push(aclOnPath(u, dir, spawn));
    }
  }
  if (a.fail2ban) {
    notes.push(writeFail2banDropIn(u, deps));
    for (const sock of [FAIL2BAN_SOCK, "/run/fail2ban/fail2ban.sock"]) {
      if (fs.existsSync(sock)) notes.push(aclOnPath(u, sock, spawn));
    }
  }
  return { ok: notes.every((n) => n.ok || n.key === "group_missing" || n.key === "path_missing"), notes };
}

export function accessManualHints(user, access) {
  const a = normalizeAccess(access);
  const u = user || "orb44";
  const lines = [];
  if (a.docker) lines.push(`usermod -aG docker ${u}`);
  if (a.journal) lines.push(`usermod -aG systemd-journal,adm ${u}`);
  if (a.fail2ban) {
    lines.push(`mkdir -p ${FAIL2BAN_DROPIN_DIR}`);
    lines.push(`# drop-in → ${FAIL2BAN_DROPIN} then: systemctl daemon-reload && systemctl restart fail2ban`);
    lines.push(`setfacl -m u:${u}:rw ${FAIL2BAN_SOCK}`);
  }
  return lines;
}

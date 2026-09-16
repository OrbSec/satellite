import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SYSTEM_DEVICE = "/var/lib/orb44/device.json";
export const SYSTEM_CLI = "/usr/local/bin/orb44";
export const SYSTEM_LIB = "/usr/lib/orb44-sat";

export function quoteShell(p) {
  const s = String(p);
  return /[\s"$]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

export function cliLinkPath({ uid = process.getuid?.(), home = os.homedir() } = {}) {
  if (uid === 0) return SYSTEM_CLI;
  return path.join(home, ".local", "bin", "orb44");
}

export function satLibRoot({ uid = process.getuid?.(), home = os.homedir() } = {}) {
  if (uid === 0) return SYSTEM_LIB;
  return path.join(home, ".local", "lib", "orb44-sat");
}

export function writeCliShim(dest, { node, script }) {
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o755 });
  const body = `#!/bin/sh\nexec ${quoteShell(node)} ${quoteShell(script)} "$@"\n`;
  fs.writeFileSync(dest, body, { mode: 0o755 });
  return dest;
}

export function pathHasDir(dir, pathEnv = process.env.PATH) {
  const want = path.resolve(dir);
  return String(pathEnv || "")
    .split(path.delimiter)
    .some((p) => p && path.resolve(p) === want);
}

export function parseDeviceJson(raw, filePath) {
  try {
    const row = JSON.parse(raw);
    if (!row?.secret) return null;
    return { ...row, path: filePath };
  } catch {
    return null;
  }
}

export function deviceSearchPaths(homeFile, systemdPath = SYSTEM_DEVICE) {
  return [...new Set([homeFile, systemdPath].filter(Boolean))];
}

export function loadFirstDevice(readFile, paths) {
  for (const p of paths) {
    try {
      const row = parseDeviceJson(readFile(p), p);
      if (row) return row;
    } catch {
      /* missing or unreadable */
    }
  }
  return null;
}

export function stripDevicePath(row) {
  if (!row) return null;
  const { path: _p, ...rest } = row;
  return rest;
}

export function hasExistingInstall({ devices = [], daemon = false, unit = false } = {}) {
  return Boolean((devices && devices.length) || daemon || unit);
}

export function pickLiveDevice(devices, { daemon = false, systemdPath = SYSTEM_DEVICE } = {}) {
  const list = Array.isArray(devices) ? devices.filter((d) => d?.secret) : [];
  if (daemon) {
    const sys = list.find((d) => d.path === systemdPath);
    if (sys) return sys;
  }
  return list[0] || null;
}

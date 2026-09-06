export const SYSTEM_DEVICE = "/var/lib/orb44/device.json";

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

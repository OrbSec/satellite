#!/usr/bin/env node
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { collectPulse, formatPulsePreview } from "../server/pulse.mjs";
import { LANGS, LANG_LABEL, detectLang, normalizeLang, t } from "../server/sat-i18n.mjs";
import { localizeInsideNote } from "../web/inside-notes.js";
import { pickFromList } from "../server/cli-menu.mjs";
import { SYSTEM_DEVICE, parseDeviceJson, hasExistingInstall, pickLiveDevice, deviceSearchPaths, loadFirstDevice, stripDevicePath } from "../server/sat-local.mjs";
import { CLI_PACKAGE, cmpVer, readCliVersion, pickSatRoots, staleSatRoots, applyUpdateTree, fetchLatestMeta, unpackTarball } from "../server/sat-update.mjs";
import { cabinetRequest, apiFailText } from "../server/sat-http.mjs";
import {
  probeAccessTargets,
  normalizeAccess,
  supplementaryGroups,
  applySatelliteAccess,
  accessManualHints,
} from "../server/sat-access.mjs";
import { runLiveTop, topIntervalSec } from "../server/sat-top.mjs";

const DEVICE_FILE = process.env.ORB44_DEVICE_FILE || path.join(os.homedir(), ".config", "orb44", "device.json");
const CLI_FILE = process.env.ORB44_CLI_FILE || path.join(path.dirname(DEVICE_FILE), "cli.json");
const SCRIPT = fileURLToPath(import.meta.url);

function args() {
  const out = { _: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--system") out.system = true;
    else if (a === "--daemon") out.daemon = true;
    else if (a === "--logs") out.logs = true;
    else if (a === "--fail2ban") out.fail2ban = true;
    else if (a === "--docker") out.docker = true;
    else if (a === "--journal") out.journal = true;
    else if (a === "--access") {
      out.fail2ban = true;
      out.docker = true;
      out.journal = true;
    }
    else if (a === "--force") out.force = true;
    else if (a === "--purge") out.purge = true;
    else if (a === "--once") out.once = true;
    else if (a === "--version" || a === "-V" || a === "-v") out.version = true;
    else if (a === "--url" || a === "--code" || a === "--name" || a === "--interval" || a === "--lang") {
      out[a.slice(2)] = argv[++i];
    } else if (!a.startsWith("-")) out._.push(a);
  }
  return out;
}

function intervalSec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 300;
  return Math.max(60, Math.min(1800, Math.round(n)));
}

function loadCli() {
  try {
    return JSON.parse(fs.readFileSync(CLI_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCli(row) {
  fs.mkdirSync(path.dirname(CLI_FILE), { recursive: true });
  fs.writeFileSync(CLI_FILE, JSON.stringify(row, null, 2), { mode: 0o600 });
}

function storedLang() {
  return normalizeLang(loadCli().lang);
}

let lang = detectLang();

function storedOrFlag(opts) {
  return normalizeLang(opts.lang) || storedLang() || detectLang();
}

function loadDeviceRecord() {
  return loadFirstDevice((p) => fs.readFileSync(p, "utf8"), deviceSearchPaths(DEVICE_FILE));
}

function loadDevice() {
  return stripDevicePath(loadDeviceRecord());
}

function saveDevice(row) {
  fs.mkdirSync(path.dirname(DEVICE_FILE), { recursive: true });
  fs.writeFileSync(DEVICE_FILE, JSON.stringify(row, null, 2), { mode: 0o600 });
}

function clearDevice() {
  try {
    fs.unlinkSync(DEVICE_FILE);
  } catch {
    /* missing */
  }
}

function api(url, pathname, opts) {
  return cabinetRequest(url, pathname, opts);
}

function failLine(out, fallbackKey = "pulse_fail") {
  return "⚠️  " + apiFailText(lang, out, t, fallbackKey);
}

function dim(s) {
  return `\x1b[2m${s}\x1b[0m`;
}

function bold(s) {
  return `\x1b[1m${s}\x1b[0m`;
}

function quote(p) {
  const s = String(p);
  return /[\s"$]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

function localCliVersion() {
  const ver = readCliVersion(SCRIPT);
  return ver && ver !== "0.0.0" ? ver : "—";
}

async function latestCliVersion() {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    const meta = await fetchLatestMeta((url, init) => fetch(url, { ...init, signal: ac.signal }));
    clearTimeout(timer);
    return meta.version;
  } catch {
    return null;
  }
}

function printVersions(current, latest) {
  const here = current && current !== "0.0.0" ? current : localCliVersion();
  console.log(dim(`${t(lang, "ver_here")}: ${here}`));
  if (!latest) {
    console.log(dim(`${t(lang, "ver_latest")}: ${t(lang, "ver_unknown")}`));
    return false;
  }
  const behind = here !== "—" && cmpVer(here, latest) < 0;
  const same = here !== "—" && cmpVer(here, latest) === 0;
  console.log(dim(`${t(lang, "ver_latest")}: ${latest}${same ? "  " + t(lang, "ver_ok") : ""}`));
  if (behind) console.log(dim(t(lang, "ver_behind", { ver: latest })));
  return behind;
}

async function printVersionPair() {
  return printVersions(localCliVersion(), await latestCliVersion());
}

function banner() {
  console.log(`\n🛰️  ${bold(t(lang, "banner_title"))}  ${dim(localCliVersion())}`);
  console.log(dim(`${t(lang, "banner_sub")}\n`));
}

async function ensureLang(opts) {
  const flagged = normalizeLang(opts.lang);
  if (flagged) {
    lang = flagged;
    saveCli({ ...loadCli(), lang });
    return lang;
  }
  const saved = storedLang();
  if (saved) {
    lang = saved;
    return lang;
  }
  lang = detectLang();
  if (opts.yes || opts.url || !input.isTTY || !output.isTTY) {
    saveCli({ ...loadCli(), lang });
    return lang;
  }
  const start = Math.max(0, LANGS.indexOf(lang));
  const idx = await pickFromList({
    title: t(lang, "lang_pick"),
    items: LANGS.map((id) => LANG_LABEL[id]),
    index: start,
    hint: "↑↓  Enter",
    stdin: input,
    stdout: output,
  });
  lang = LANGS[idx] || lang;
  saveCli({ ...loadCli(), lang });
  console.log(dim(t(lang, "lang_saved", { label: LANG_LABEL[lang] })));
  return lang;
}

async function wantDaemon(opts, { ifYes = false, index = 0 } = {}) {
  if (opts.daemon) return true;
  if (opts.yes) return ifYes;
  if (!input.isTTY || !output.isTTY) return ifYes;
  const idx = await pickFromList({
    title: t(lang, "ask_daemon"),
    items: [t(lang, "daemon_no"), t(lang, "daemon_yes")],
    index,
    hint: "↑↓  Enter",
    stdin: input,
    stdout: output,
  });
  return idx === 1;
}

function printAdvice(notes) {
  const list = Array.isArray(notes) ? notes.map((n) => localizeInsideNote(n, lang)).filter((n) => n?.title) : [];
  if (!list.length) return;
  console.log(`\n${bold("📋  " + t(lang, "advice_title"))}`);
  console.log(dim(t(lang, "advice_sub")));
  for (const n of list.slice(0, 8)) {
    console.log(`   • ${n.title}`);
    if (n.do) console.log(dim(`     ${n.do}`));
  }
}

async function wantLogs(opts) {
  if (opts.logs) return true;
  if (opts.yes) return false;
  if (!input.isTTY || !output.isTTY) return false;
  const idx = await pickFromList({
    title: t(lang, "ask_logs"),
    items: [t(lang, "logs_no"), t(lang, "logs_yes")],
    index: 0,
    hint: "↑↓  Enter",
    stdin: input,
    stdout: output,
  });
  return idx === 1;
}

async function wantOneAccess(opts, flag, titleKey, yesKey, noKey, { ifYes = false, index = 1 } = {}) {
  if (opts[flag]) return true;
  if (opts.access) return true;
  if (opts.yes) return ifYes;
  if (!input.isTTY || !output.isTTY) return ifYes;
  const idx = await pickFromList({
    title: t(lang, titleKey),
    items: [t(lang, noKey), t(lang, yesKey)],
    index,
    hint: "↑↓  Enter",
    stdin: input,
    stdout: output,
  });
  return idx === 1;
}

async function wantAccess(opts, { logs = false } = {}) {
  const probe = probeAccessTargets();
  const ifYes = Boolean(opts.logs || logs);
  const access = normalizeAccess({
    fail2ban: probe.fail2ban
      ? await wantOneAccess(opts, "fail2ban", "ask_access_fail2ban", "access_yes", "access_no", { ifYes, index: 1 })
      : Boolean(opts.fail2ban),
    docker: probe.docker
      ? await wantOneAccess(opts, "docker", "ask_access_docker", "access_yes", "access_no", { ifYes, index: 1 })
      : Boolean(opts.docker),
    journal: probe.journal || probe.webLogs
      ? await wantOneAccess(opts, "journal", "ask_access_journal", "access_yes", "access_no", {
          ifYes: ifYes || logs,
          index: logs ? 1 : 0,
        })
      : Boolean(opts.journal),
  });
  return { access, probe };
}

function applyGrants(device, extra = {}) {
  const grants = {
    process: true,
    daemon: extra.daemon != null ? Boolean(extra.daemon) : Boolean(device.grants?.daemon),
    logs: extra.logs != null ? Boolean(extra.logs) : Boolean(device.grants?.logs),
    ...normalizeAccess({
      fail2ban: extra.fail2ban != null ? extra.fail2ban : device.grants?.fail2ban,
      docker: extra.docker != null ? extra.docker : device.grants?.docker,
      journal: extra.journal != null ? extra.journal : device.grants?.journal,
    }),
  };
  device.grants = grants;
  return grants;
}

async function sendPulse(device, { preview = true } = {}) {
  const pulse = collectPulse({ grants: device.grants });
  const ver = readCliVersion(SCRIPT);
  if (ver && ver !== "0.0.0") pulse.cliVersion = ver;
  if (preview) {
    console.log(bold("📡 " + t(lang, "payload")));
    console.log(formatPulsePreview(pulse, lang));
  }
  const out = await api(device.api, `/api/satellites/${device.id}/pulse`, {
    method: "POST",
    secret: device.secret,
    json: pulse,
  });
  return { out, pulse };
}

async function wantReplace(found, opts) {
  if (opts.force) return true;
  if (opts.yes || !input.isTTY || !output.isTTY) return false;
  const lines = [t(lang, "already_title")];
  for (const d of found.devices) {
    lines.push(t(lang, "already_host", { host: d.host || "—", name: d.name || "—" }));
    lines.push(t(lang, "already_key", { file: d.path }));
  }
  if (found.daemon) lines.push(t(lang, "already_daemon"));
  else if (found.unit) lines.push(t(lang, "already_unit"));
  const idx = await pickFromList({
    title: lines.join("\n"),
    items: [t(lang, "already_keep"), t(lang, "already_replace")],
    index: 0,
    hint: "↑↓  Enter",
    stdin: input,
    stdout: output,
  });
  return idx === 1;
}

function existingOnBox() {
  const paths = [...new Set([DEVICE_FILE, SYSTEM_DEVICE])];
  const devices = [];
  for (const p of paths) {
    try {
      const row = parseDeviceJson(fs.readFileSync(p, "utf8"), p);
      if (row) devices.push(row);
    } catch {
      /* missing or unreadable */
    }
  }
  const unit =
    fs.existsSync("/etc/systemd/system/orb44-satellite.service") ||
    fs.existsSync(path.join(os.homedir(), ".config", "systemd", "user", "orb44-satellite.service"));
  let daemon = false;
  try {
    daemon = serviceIsActive(true) || serviceIsActive(false);
  } catch {
    daemon = false;
  }
  return { devices, daemon, unit };
}

async function revokeLocalDevices(devices, fallbackApi) {
  for (const d of devices) {
    const apiBase = d.api || fallbackApi;
    if (!apiBase || !d.secret) continue;
    await api(apiBase, "/api/satellites/logout", { method: "POST", json: { secret: d.secret } }).catch(() => {});
  }
  clearDevice();
  if (SYSTEM_DEVICE !== DEVICE_FILE) {
    try {
      fs.unlinkSync(SYSTEM_DEVICE);
    } catch {
      /* missing */
    }
  }
}

async function cmdLogin(opts) {
  const url = String(opts.url || process.env.ORB44_API || "http://127.0.0.1:8787").replace(/\/$/, "");
  process.stdout.write(`orb44 login → ${url}\n`);
  await ensureLang(opts);
  banner();
  const found = existingOnBox();
  if (hasExistingInstall(found)) {
    const replace = await wantReplace(found, opts);
    if (!replace) {
      const live = pickLiveDevice(found.devices, { daemon: found.daemon });
      if (!live?.secret) {
        console.log(t(lang, "already_no_key"));
        process.exit(0);
      }
      const { out } = await sendPulse(live);
      if (!out.ok) {
        console.error(failLine(out));
        process.exit(1);
      }
      console.log("\n📡  " + t(lang, "pulse_ok"));
      printAdvice(out.body?.notes);
      console.log(dim("\n" + t(lang, "already_kept")));
      process.exit(0);
    }
    await revokeLocalDevices(found.devices, url);
  }
  const hostname = os.hostname();
  const name = opts.name || hostname;
  const begin = await api(url, "/api/satellites/pair/begin", {
    method: "POST",
    json: { hostname, name },
  });
  if (!begin.ok || !begin.body.pollToken) {
    console.error(failLine(begin, "pair_fail"));
    process.exit(1);
  }
  console.log(`🔗  API ${url}`);
  console.log(`🌐  ${t(lang, "open_link")}\n`);
  console.log(`  ${bold(begin.body.verifyUrl)}`);
  console.log(dim(`  ${t(lang, "code", { code: begin.body.userCode })}\n`));
  console.log("⏳  " + t(lang, "waiting"));
  const deadline = Date.now() + (Number(begin.body.expiresInSec) || 600) * 1000;
  let issued = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await api(url, "/api/satellites/pair/poll", {
      method: "POST",
      json: { pollToken: begin.body.pollToken },
    });
    if (poll.body?.status === "done") {
      issued = poll.body;
      break;
    }
    if (poll.status === 404) {
      console.error("\n⚠️  " + t(lang, "code_expired"));
      process.exit(1);
    }
    process.stdout.write(".");
  }
  if (!issued?.secret) {
    console.error("\n⚠️  " + t(lang, "no_confirm"));
    process.exit(1);
  }
  const device = {
    api: url,
    id: issued.id,
    secret: issued.secret,
    host: issued.host,
    name: issued.name,
    pairedAt: Date.now(),
  };
  saveDevice(device);
  console.log(`\n\n✅  ${t(lang, "paired", { host: device.host, name: device.name })}`);
  console.log(dim(`🔑  ${t(lang, "key_file", { file: DEVICE_FILE })}\n`));

  const daemon = await wantDaemon(opts);
  const logs = await wantLogs(opts);
  const grants = applyGrants(device, { daemon, logs });
  persistDevice(device, [SYSTEM_DEVICE]);
  printGrants(grants);
  if (logs) console.log(dim(t(lang, "logs_on")));
  else console.log(dim(t(lang, "logs_skip")));

  const { out } = await sendPulse(device);
  if (!out.ok) {
    console.error(failLine(out));
    process.exit(1);
  }
  console.log("\n📡  " + t(lang, "pulse_ok"));
  printAdvice(out.body?.notes);
  if (daemon) {
    const installed = await cmdInstall({ ...opts, daemon: true, logs }, { enable: true, skipAsk: true });
    if (installed) console.log("\n" + t(lang, "login_done"));
  } else {
    console.log(dim("\n" + t(lang, "daemon_skip")));
  }
  process.exit(0);
}

function applyLang(opts) {
  lang = storedOrFlag(opts);
  return lang;
}

async function cmdPulse() {
  applyLang(opts);
  const device = loadDevice();
  if (!device?.secret) {
    console.error("⚠️  " + t(lang, "need_login"));
    process.exit(1);
  }
  banner();
  const { out } = await sendPulse(device);
  if (!out.ok) {
    console.error(failLine(out));
    process.exit(1);
  }
  console.log("\n📡  " + t(lang, "pulse_ok"));
  printAdvice(out.body?.notes);
}

async function cmdDaemon(opts) {
  applyLang(opts);
  const device = loadDevice();
  if (!device?.secret) {
    console.error("⚠️  " + t(lang, "need_login"));
    process.exit(1);
  }
  const sec = intervalSec(opts.interval);
  console.log(`🛰️  ${t(lang, "daemon_run", { sec, host: device.host })}`);
  const tick = async () => {
    const hh = new Date().toISOString().slice(11, 19);
    try {
      const fresh = loadDevice();
      if (fresh?.secret) Object.assign(device, fresh);
      const { out, pulse } = await sendPulse(device, { preview: false });
      if (!out.ok) {
        console.error(`⚠️  ${hh} ${apiFailText(lang, out, t)}`);
        return;
      }
      console.log(`📡  ${hh} ok  load ${pulse.load1}  ${pulse.gradeInside || "—"}`);
    } catch (e) {
      console.error(`⚠️  ${hh} ${String(e?.message || e).split("\n")[0].slice(0, 200)}`);
    }
  };
  await tick();
  const id = setInterval(tick, sec * 1000);
  const stop = () => {
    clearInterval(id);
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await new Promise(() => {});
}

function systemdUnit({ node, script, deviceFile, interval, user, groups = [] }) {
  const lines = [
    "[Unit]",
    "Description=Orb44 satellite pulse",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
  ];
  if (user) {
    lines.push(`User=${user}`, `Group=${user}`);
    const supp = (groups || []).filter(Boolean);
    if (supp.length) lines.push(`SupplementaryGroups=${supp.join(" ")}`);
  }
  lines.push(
    `ExecStart=${quote(node)} ${quote(script)} daemon --interval ${interval}`,
    "Restart=on-failure",
    "RestartSec=20",
    `Environment=ORB44_DEVICE_FILE=${deviceFile}`,
    `Environment=ORB44_LANG=${lang}`,
    "NoNewPrivileges=true",
    "",
    "[Install]",
    `WantedBy=${user ? "multi-user.target" : "default.target"}`
  );
  return `${lines.join("\n")}\n`;
}

const CLI_LINK = "/usr/local/bin/orb44";

function linkSystemCli(node, script) {
  const body = `#!/bin/sh\nexec ${quote(node)} ${quote(script)} "$@"\n`;
  fs.writeFileSync(CLI_LINK, body, { mode: 0o755 });
}

function installSystemTree() {
  const lib = "/usr/lib/orb44-sat";
  const srcRoot = path.join(path.dirname(SCRIPT), "..");
  fs.mkdirSync(path.join(lib, "bin"), { recursive: true, mode: 0o755 });
  fs.mkdirSync(path.join(lib, "server"), { recursive: true, mode: 0o755 });
  applyUpdateTree(srcRoot, lib);
  const ver = readCliVersion(SCRIPT);
  if (ver && ver !== "0.0.0") {
    fs.writeFileSync(
      path.join(lib, "package.json"),
      JSON.stringify({ name: CLI_PACKAGE, version: ver, type: "module", private: true }, null, 2) + "\n",
      { mode: 0o644 }
    );
  }
  return path.join(lib, "bin", "orb44.mjs");
}

function nologinShell() {
  for (const p of ["/usr/sbin/nologin", "/sbin/nologin", "/bin/false"]) {
    if (fs.existsSync(p)) return p;
  }
  return "/bin/false";
}

function ensureSystemServiceAccount(srcDeviceFile) {
  const home = "/var/lib/orb44";
  const dest = path.join(home, "device.json");
  const hasUser = spawnSync("id", ["-u", "orb44"], { encoding: "utf8" }).status === 0;
  if (!hasUser) {
    const add = spawnSync("useradd", ["-r", "-s", nologinShell(), "-d", home, "-M", "orb44"], { encoding: "utf8" });
    if (add.status !== 0) {
      const err = (add.stderr || add.stdout || "useradd failed").trim();
      return { ok: false, err: err.slice(0, 200) };
    }
  }
  fs.mkdirSync(home, { recursive: true, mode: 0o750 });
  if (path.resolve(srcDeviceFile) !== path.resolve(dest)) {
    fs.copyFileSync(srcDeviceFile, dest);
  }
  fs.chmodSync(dest, 0o600);
  const chown = spawnSync("chown", ["-R", "orb44:orb44", home], { encoding: "utf8" });
  if (chown.status !== 0) {
    return { ok: false, err: (chown.stderr || "chown failed").trim().slice(0, 200) };
  }
  try {
    const script = installSystemTree();
    return { ok: true, user: "orb44", deviceFile: dest, script };
  } catch (e) {
    return { ok: false, err: String(e.message || e).slice(0, 200) };
  }
}

function serviceIsActive(asSystem) {
  const args = asSystem ? ["is-active", "orb44-satellite"] : ["--user", "is-active", "orb44-satellite"];
  const r = spawnSync("systemctl", args, { encoding: "utf8" });
  return (r.stdout || "").trim() === "active";
}

function tryEnable(asSystem) {
  const args = asSystem
    ? [
        ["daemon-reload"],
        ["enable", "--now", "orb44-satellite"],
      ]
    : [
        ["--user", "daemon-reload"],
        ["--user", "enable", "--now", "orb44-satellite"],
      ];
  for (const a of args) {
    const r = spawnSync("systemctl", a, { encoding: "utf8" });
    if (r.status !== 0) {
      const err = (r.stderr || r.stdout || r.error?.message || "").trim();
      return { ok: false, err: err.slice(0, 240) };
    }
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) {
    if (serviceIsActive(asSystem)) return { ok: true };
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  const st = spawnSync(
    "systemctl",
    asSystem ? ["status", "--no-pager", "-l", "orb44-satellite"] : ["--user", "status", "--no-pager", "-l", "orb44-satellite"],
    { encoding: "utf8" }
  );
  return { ok: false, err: (st.stdout || st.stderr || "not active").trim().slice(0, 240) };
}

function persistDevice(device, extraPaths = []) {
  saveDevice(device);
  const body = JSON.stringify(device, null, 2);
  for (const p of extraPaths) {
    if (!p || path.resolve(p) === path.resolve(DEVICE_FILE)) continue;
    try {
      fs.writeFileSync(p, body, { mode: 0o600 });
    } catch {
      /* other key unreadable */
    }
  }
}

function printGrants(grants) {
  const on = t(lang, "grant_on");
  const off = t(lang, "grant_off");
  console.log(dim(t(lang, "grant_process") + ": " + on));
  console.log(dim(t(lang, "grant_daemon") + ": " + (grants.daemon ? on : off)));
  console.log(dim(t(lang, "grant_logs") + ": " + (grants.logs ? on : off)));
  console.log(dim(t(lang, "grant_fail2ban") + ": " + (grants.fail2ban ? on : off)));
  console.log(dim(t(lang, "grant_docker") + ": " + (grants.docker ? on : off)));
  console.log(dim(t(lang, "grant_journal") + ": " + (grants.journal ? on : off)));
}

function printAccessNotes(notes) {
  for (const n of notes || []) {
    if (n.key === "group_missing" || n.key === "path_missing" || n.key === "setfacl_ok") continue;
    if (n.ok) console.log(dim("   ✓ " + t(lang, `access_note_${n.key}`, { detail: n.detail })));
    else console.log(dim("   ! " + t(lang, `access_note_${n.key}`, { detail: n.detail })));
  }
}

async function cmdInstall(opts, { enable = false, skipAsk = false } = {}) {
  applyLang(opts);
  if (!skipAsk) await printVersionPair();
  const rec = loadDeviceRecord();
  if (!rec?.secret) {
    console.error("⚠️  " + t(lang, "need_login"));
    process.exit(1);
  }
  const srcPath = rec.path || DEVICE_FILE;
  const device = stripDevicePath(rec);
  if (opts.url) device.api = String(opts.url).replace(/\/$/, "");
  let daemon;
  let logs;
  let access;
  if (skipAsk) {
    daemon = opts.daemon != null ? Boolean(opts.daemon) : Boolean(device.grants?.daemon);
    logs = opts.logs != null ? Boolean(opts.logs) : Boolean(device.grants?.logs);
    access = normalizeAccess({
      fail2ban: opts.fail2ban != null ? opts.fail2ban : device.grants?.fail2ban,
      docker: opts.docker != null ? opts.docker : device.grants?.docker,
      journal: opts.journal != null ? opts.journal : device.grants?.journal,
    });
  } else {
    daemon = await wantDaemon(opts, { ifYes: true, index: 1 });
    logs = await wantLogs(opts);
    const got = await wantAccess(opts, { logs });
    access = got.access;
  }
  const grants = applyGrants(device, { daemon, logs, ...access });
  persistDevice(device, [srcPath, SYSTEM_DEVICE]);
  printGrants(grants);
  if (logs) console.log(dim(t(lang, "logs_on")));
  else console.log(dim(t(lang, "logs_skip")));
  const asSystem = Boolean(opts.system) || process.getuid?.() === 0;
  const interval = intervalSec(opts.interval);
  let deviceFile = DEVICE_FILE;
  let user = null;
  let script = SCRIPT;
  let groups = [];
  if (asSystem) {
    const acct = ensureSystemServiceAccount(srcPath);
    if (acct.ok) {
      deviceFile = acct.deviceFile;
      user = acct.user;
      script = acct.script;
      persistDevice(device, [SYSTEM_DEVICE]);
      try {
        spawnSync("chown", ["orb44:orb44", SYSTEM_DEVICE], { encoding: "utf8" });
      } catch {
        /* key stays root-owned until next chown -R */
      }
      console.log(dim(t(lang, "daemon_user", { user, file: deviceFile })));
      if (access.fail2ban || access.docker || access.journal) {
        console.log(dim(t(lang, "access_applying")));
        const applied = applySatelliteAccess(user, access);
        printAccessNotes(applied.notes);
        groups = supplementaryGroups(access);
        if (groups.length) console.log(dim(t(lang, "access_groups", { groups: groups.join(" ") })));
      }
    } else {
      console.log(dim(t(lang, "daemon_user_fail", { err: acct.err ? `: ${acct.err}` : "" })));
    }
  } else if (access.fail2ban || access.docker || access.journal) {
    console.log(dim(t(lang, "access_need_root")));
    for (const line of accessManualHints("orb44", access)) console.log(dim("   " + line));
  }
  const unit = systemdUnit({
    node: process.execPath,
    script,
    deviceFile,
    interval,
    user,
    groups,
  });
  const unitPath = asSystem
    ? "/etc/systemd/system/orb44-satellite.service"
    : path.join(os.homedir(), ".config", "systemd", "user", "orb44-satellite.service");
  fs.mkdirSync(path.dirname(unitPath), { recursive: true });
  fs.writeFileSync(unitPath, unit, { mode: 0o644 });
  console.log("⚙️  " + t(lang, "unit_written", { path: unitPath }));
  if (asSystem) {
    try {
      linkSystemCli(process.execPath, script);
      console.log(dim(t(lang, "cli_link", { path: CLI_LINK })));
    } catch {
      /* /usr/local/bin missing */
    }
  }
  if (enable && daemon) {
    const on = tryEnable(asSystem);
    if (on.ok) {
      spawnSync("systemctl", asSystem ? ["try-restart", "orb44-satellite"] : ["--user", "try-restart", "orb44-satellite"], {
        encoding: "utf8",
      });
      console.log("✅  " + t(lang, "daemon_on"));
      try {
        await sendPulse(device, { preview: false });
      } catch {
        /* next daemon tick */
      }
      return true;
    }
    console.log("⚠️  " + t(lang, "unit_enable_fail", { err: on.err ? `: ${on.err}` : "" }));
  } else if (!daemon) {
    console.log(dim(t(lang, "daemon_skip")));
    return false;
  }
  if (asSystem) {
    console.log(dim("   " + t(lang, "install_root")));
    console.log(dim("   useradd -r -s /usr/sbin/nologin -d /var/lib/orb44 orb44"));
    console.log(dim("   " + t(lang, "copy_key")));
    console.log("   systemctl daemon-reload && systemctl enable --now orb44-satellite");
  } else {
    console.log("   systemctl --user daemon-reload && systemctl --user enable --now orb44-satellite");
  }
  return false;
}

function tryDisable(asSystem) {
  const args = asSystem
    ? [
        ["disable", "--now", "orb44-satellite"],
        ["daemon-reload"],
      ]
    : [
        ["--user", "disable", "--now", "orb44-satellite"],
        ["--user", "daemon-reload"],
      ];
  for (const a of args) {
    spawnSync("systemctl", a, { encoding: "utf8" });
  }
}

function rmTree(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* missing */
  }
}

async function cmdUninstall(opts) {
  applyLang(opts);
  const asSystem = Boolean(opts.system) || process.getuid?.() === 0;
  tryDisable(asSystem);
  tryDisable(!asSystem);
  const unitPaths = [
    "/etc/systemd/system/orb44-satellite.service",
    path.join(os.homedir(), ".config", "systemd", "user", "orb44-satellite.service"),
  ];
  for (const p of unitPaths) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* missing */
    }
  }
  rmTree("/usr/lib/orb44-sat");
  try {
    fs.unlinkSync(CLI_LINK);
  } catch {
    /* missing */
  }
  if (opts.purge) {
    const found = existingOnBox();
    await revokeLocalDevices(found.devices, found.devices[0]?.api);
    rmTree("/var/lib/orb44");
    spawnSync("userdel", ["orb44"], { encoding: "utf8" });
    console.log("✅  " + t(lang, "uninstall_purged"));
    return;
  }
  console.log("✅  " + t(lang, "uninstall_ok"));
  console.log(dim(t(lang, "uninstall_key_kept", { file: SYSTEM_DEVICE })));
}

async function cmdUpdate() {
  applyLang(opts);
  const current = readCliVersion(SCRIPT);
  let meta;
  try {
    meta = await fetchLatestMeta();
  } catch (e) {
    printVersions(current, null);
    console.error("⚠️  " + t(lang, "update_fail", { err: `: ${String(e.message || e).slice(0, 160)}` }));
    process.exit(1);
  }
  printVersions(current, meta.version);
  const pin = t(lang, "update_npx", { version: meta.version });
  const roots = pickSatRoots(SCRIPT);
  const stale = staleSatRoots(roots, meta.version, { force: Boolean(opts.force) });
  if (!roots.length) {
    console.error("⚠️  " + t(lang, "update_no_tree"));
    console.log(dim(pin));
    process.exit(1);
  }
  if (!stale.length) {
    console.log("✅  " + t(lang, "update_same", { version: current || meta.version }));
    console.log(dim(pin));
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orb44-upd-"));
  let wrote = [];
  try {
    const pkg = await unpackTarball(meta.tarball, tmp, fetch, {
      integrity: meta.integrity,
      shasum: meta.shasum,
    });
    const blocked = [];
    for (const root of stale) {
      try {
        applyUpdateTree(pkg, root);
        wrote.push(root);
      } catch (e) {
        blocked.push({ root, err: String(e.message || e).slice(0, 160) });
      }
    }
    if (!wrote.length) {
      console.error("⚠️  " + t(lang, blocked.some((b) => /EACCES|permission/i.test(b.err)) ? "update_need_root" : "update_fail", { err: blocked[0]?.err ? `: ${blocked[0].err}` : "" }));
      process.exit(1);
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* tmp */
    }
  }
  for (const root of wrote) {
    console.log("✅  " + t(lang, "update_wrote", { version: meta.version, path: root }));
  }
  if (wrote.includes("/usr/lib/orb44-sat") && serviceIsActive(true)) {
    spawnSync("systemctl", ["try-restart", "orb44-satellite"], { encoding: "utf8" });
    console.log(dim(t(lang, "update_restarted")));
  }
  console.log(dim(pin));
}

async function cmdTop(flags) {
  applyLang(flags);
  const device = loadDevice();
  const sec = topIntervalSec(flags.interval);
  const out = await runLiveTop({
    lang,
    intervalSec: sec,
    once: Boolean(flags.once),
    grants: device?.grants || null,
    version: localCliVersion(),
  });
  if (out?.exit === 130) process.exit(130);
}

async function cmdVersion() {
  applyLang(opts);
  await printVersionPair();
}

async function cmdStatus() {
  applyLang(opts);
  const device = loadDevice();
  banner();
  await printVersionPair();
  if (!device) {
    console.log("⚠️  " + t(lang, "not_paired"));
    return;
  }
  console.log(`🔗  API  ${device.api}`);
  console.log(`🌐  ${device.host}`);
  console.log(`📛  ${device.name}`);
  console.log(`🆔  ${device.id}`);
  console.log(dim(`🔑  ${DEVICE_FILE}`));
  const pulse = collectPulse({ grants: device.grants });
  console.log(`\n${bold("📡 " + t(lang, "now_on_box"))}`);
  console.log(formatPulsePreview(pulse, lang));
}

async function cmdLogout() {
  applyLang(opts);
  const device = loadDevice();
  if (device?.secret) {
    await api(device.api, "/api/satellites/logout", { method: "POST", json: { secret: device.secret } }).catch(() => {});
  }
  clearDevice();
  console.log("✅  " + t(lang, "logged_out"));
}

async function cmdLang(flags) {
  const want = normalizeLang(flags._[1] || flags.lang);
  if (want) {
    lang = want;
    saveCli({ ...loadCli(), lang });
    console.log(t(lang, "lang_saved", { label: LANG_LABEL[lang] }));
    return;
  }
  applyLang(flags);
  if (input.isTTY && output.isTTY) {
    const idx = await pickFromList({
      title: t(lang, "lang_pick"),
      items: LANGS.map((id) => LANG_LABEL[id]),
      index: Math.max(0, LANGS.indexOf(lang)),
      hint: "↑↓  Enter",
      stdin: input,
      stdout: output,
    });
    lang = LANGS[idx] || lang;
    saveCli({ ...loadCli(), lang });
    console.log(t(lang, "lang_saved", { label: LANG_LABEL[lang] }));
    return;
  }
  console.log(t(lang, "lang_now", { label: LANG_LABEL[lang] }));
}

function help() {
  applyLang(opts);
  console.log(t(lang, "help", { file: DEVICE_FILE, version: localCliVersion() }));
}

const opts = args();
const cmd = opts.version ? "version" : opts._[0] || "help";
const run = {
  login: () => cmdLogin(opts),
  pulse: cmdPulse,
  top: () => cmdTop(opts),
  daemon: () => cmdDaemon(opts),
  install: () => cmdInstall(opts, { enable: true }),
  uninstall: () => cmdUninstall(opts),
  status: cmdStatus,
  update: cmdUpdate,
  version: cmdVersion,
  logout: cmdLogout,
  lang: () => cmdLang(opts),
  help,
};
const fn = run[cmd];
if (!fn) {
  help();
  process.exit(1);
}
try {
  await fn();
} catch (e) {
  console.error("⚠️  " + String(e?.message || e).split("\n")[0].slice(0, 200));
  process.exit(1);
}

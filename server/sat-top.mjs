/**
 * Live perimeter view for `orb44 top`.
 * Free CLI: current snapshot + in-session sparklines. No Watch, no street delta, nothing persisted.
 */
import os from "node:os";
import {
  collapseListen,
  collectPulse,
  gradeInside,
  hotFromTop,
  isPulseHelper,
  looksLikeMiner,
  serviceName,
} from "./pulse.mjs";
import { t } from "./sat-i18n.mjs";
import { incompleteEscape, parseMenuKey } from "./cli-menu.mjs";

const SPARK = " .-=#";
export const TOP_HISTORY = 90;

function dim(s) {
  return `\x1b[2m${s}\x1b[0m`;
}

function bold(s) {
  return `\x1b[1m${s}\x1b[0m`;
}

function gradePaint(g) {
  const s = String(g || "—");
  if (s === "A") return `\x1b[32m${bold(s)}\x1b[0m`;
  if (s === "B") return `\x1b[36m${bold(s)}\x1b[0m`;
  if (s === "C") return `\x1b[33m${bold(s)}\x1b[0m`;
  if (s === "D") return `\x1b[31m${bold(s)}\x1b[0m`;
  return bold(s);
}

export function visLen(s) {
  return String(s ?? "").replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function pad(s, n, { align = "left" } = {}) {
  const str = String(s ?? "");
  const extra = n - visLen(str);
  if (extra > 0) return align === "right" ? " ".repeat(extra) + str : str + " ".repeat(extra);
  if (extra === 0) return str;
  return clipLine(str, Math.max(0, n));
}

export function clipLine(s, cols) {
  const max = Math.max(0, Math.floor(Number(cols) || 0));
  const str = String(s ?? "");
  let out = "";
  let n = 0;
  for (let i = 0; i < str.length; ) {
    if (str[i] === "\u001b" && str[i + 1] === "[") {
      const m = str.slice(i).match(/^\u001b\[[0-9;]*m/);
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (n >= max) break;
    out += str[i];
    n += 1;
    i += 1;
  }
  return out;
}

function fillColor(pct) {
  if (pct >= 90) return "\x1b[31m";
  if (pct >= 70) return "\x1b[33m";
  return "\x1b[32m";
}

export function bar(pct, width = 10) {
  const w = Math.max(4, Math.floor(Number(width) || 0));
  const n = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((n / 100) * w);
  return `${fillColor(n)}${"|".repeat(filled)}\x1b[0m${" ".repeat(Math.max(0, w - filled))}`;
}

/** htop-style `Mem[||||||||     5.7G/15.6G]` — value sits in the empty tail, never on the right margin. */
export function htopBar(label, pct, text, width) {
  const prefix = `${label}[`;
  const inner = Math.max(8, Math.floor(Number(width) || 0) - visLen(prefix) - 1);
  const value = ` ${text}`;
  const textW = Math.min(inner - 1, Math.max(visLen(value), 6));
  const barW = Math.max(1, inner - textW);
  const n = Math.max(0, Math.min(100, Number(pct) || 0));
  return `${prefix}${bar(n, barW)}${dim(pad(value, textW, { align: "right" }))}]`;
}

export function cpuTick(prev, cpus = os.cpus()) {
  const list = Array.isArray(cpus) ? cpus : [];
  const snap = list.map((c) => {
    const t = c?.times || {};
    const total = ["user", "nice", "sys", "idle", "irq"].reduce((a, k) => a + (Number(t[k]) || 0), 0);
    return { idle: Number(t.idle) || 0, total };
  });
  const pcts = snap.map((s, i) => {
    const p = prev?.[i];
    if (!p || s.total <= p.total) return 0;
    const dt = s.total - p.total;
    const di = Math.max(0, s.idle - p.idle);
    return Math.max(0, Math.min(100, (1 - di / dt) * 100));
  });
  return { snap, pcts };
}

function fmtUptime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const clock = `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return d ? `${d} days, ${clock}` : clock;
}

function cpuMeterLines(pcts, width) {
  const n = Math.max(1, Math.min(16, pcts.length));
  const colsN = n <= 1 ? 1 : n <= 4 ? 2 : 4;
  const rowsN = Math.ceil(n / colsN);
  const cellW = Math.max(12, Math.floor((width - (colsN - 1)) / colsN));
  const lines = [];
  for (let row = 0; row < rowsN; row++) {
    const parts = [];
    for (let col = 0; col < colsN; col++) {
      const i = col * rowsN + row;
      if (i >= n) {
        parts.push(pad("", cellW));
        continue;
      }
      const p = Number(pcts[i]) || 0;
      const label = String(i).padStart(Math.max(1, String(n - 1).length), " ");
      parts.push(htopBar(label, p, `${p.toFixed(1)}%`, cellW));
    }
    lines.push(parts.join(" ").trimEnd());
  }
  return lines;
}

export function sparkline(values, width) {
  const w = Math.max(2, Math.min(120, Math.floor(Number(width) || 0)));
  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return " ".repeat(w);
  const slice = nums.length > w ? nums.slice(nums.length - w) : nums;
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  const span = max - min || 1;
  const chars = slice.map((v) => SPARK[Math.min(SPARK.length - 1, Math.max(0, Math.round(((v - min) / span) * (SPARK.length - 1))))]);
  return chars.join("") + " ".repeat(Math.max(0, w - chars.length));
}

export function pushTopSample(history, pulse, { cap = TOP_HISTORY } = {}) {
  const h = history && typeof history === "object" ? history : { load: [], ram: [], disk: [] };
  if (!Array.isArray(h.load)) h.load = [];
  if (!Array.isArray(h.ram)) h.ram = [];
  if (!Array.isArray(h.disk)) h.disk = [];
  h.load.push(Number(pulse?.load1) || 0);
  h.ram.push(memPct(pulse));
  h.disk.push(Number(pulse?.diskUsedPct) || 0);
  while (h.load.length > cap) h.load.shift();
  while (h.ram.length > cap) h.ram.shift();
  while (h.disk.length > cap) h.disk.shift();
  return h;
}

function gb(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return (x / 1024 / 1024 / 1024).toFixed(1);
}

function memPct(pulse) {
  const u = Number(pulse.memUsed);
  const t0 = Number(pulse.memTotal);
  if (!Number.isFinite(u) || !Number.isFinite(t0) || t0 <= 0) return 0;
  return Math.min(100, (u / t0) * 100);
}

export function termSize(stdout = process.stdout) {
  const rawCols = Number(stdout?.columns) || 80;
  const rawRows = Number(stdout?.rows) || 24;
  // Never paint into the last column: autowrap there scrolls the header off.
  const cols = Math.max(60, Math.min(240, Math.max(1, rawCols - 1)));
  const rows = Math.max(16, Math.min(80, rawRows));
  return { cols, rows };
}

/** Same access classes as the dashboard listen table (labels only — no history). */
export function listenAccessKind(r) {
  const addr = String(r.addr || "");
  const local = addr === "127.0.0.1" || addr === "::1" || addr.startsWith("127.");
  const all = addr === "0.0.0.0" || addr === "::" || addr === "*";
  const admin = new Set([
    2019, 2375, 2376, 3306, 5432, 6379, 27017, 9200, 11211, 15672, 8500, 2379, 6443, 9090, 5601, 7474, 7687, 1080, 6432,
    11434, 6333, 19530, 9229, 9222, 18789, 10050, 10051,
  ]);
  const mail = new Set([25, 465, 587, 993, 995, 110, 143]);
  const vpnOk = new Set([1194, 500, 4500, 51820]);
  const vpnWeak = new Set([1701, 1723]);
  if (all && admin.has(Number(r.port))) return "risk";
  if (local) return "local";
  if (all && (r.port === 80 || r.port === 443 || vpnOk.has(Number(r.port)))) return "ok";
  if (all && (r.port === 22 || mail.has(Number(r.port)))) return "info";
  if (all && vpnWeak.has(Number(r.port))) return "warn";
  if (all) return "warn";
  return "local";
}

function accessLabel(lang, kind) {
  if (kind === "local") return t(lang, "top_acc_local");
  if (kind === "ok") return t(lang, "top_acc_web");
  if (kind === "info") return t(lang, "top_acc_restricted");
  if (kind === "risk") return t(lang, "top_acc_public");
  return t(lang, "top_acc_public");
}

export function topIntervalSec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(30, Math.round(n)));
}

function infoLines(pulse, lang, opts = {}) {
  const h = pulse?.hardening || {};
  const apps = pulse?.apps || {};
  const ssh = h.sshPassword ? t(lang, "preview_ssh_pass") : h.sshPassword === false ? t(lang, "preview_ssh_key") : "—";
  const listen = collapseListen([...(pulse?.listen || [])]);
  const kinds = { risk: 0, warn: 0, info: 0, ok: 0, local: 0 };
  for (const r of listen) kinds[listenAccessKind(r)] = (kinds[listenAccessKind(r)] || 0) + 1;
  const street = kinds.risk + kinds.warn;
  const l1 = Number.isFinite(Number(pulse?.load1)) ? Number(pulse.load1).toFixed(2) : "—";
  const l5 = Number.isFinite(Number(pulse?.load5)) ? Number(pulse.load5).toFixed(2) : null;
  const l15 = Number.isFinite(Number(pulse?.load15)) ? Number(pulse.load15).toFixed(2) : null;
  const load = [l1, l5, l15].filter(Boolean).join(" ");
  const lines = [
    `${t(lang, "top_loadavg")}: ${load}`,
    `${t(lang, "top_uptime")}: ${fmtUptime(opts.uptimeSec)}`,
    `SSH ${ssh} · ${t(lang, "preview_row_fw")} ${h.firewall || t(lang, "preview_fw_no")}`,
    `${h.fail2ban || t(lang, "preview_ban_no")}${h.timesync ? ` · ${h.timesync}` : ""}${h.updates ? ` · ${t(lang, "preview_row_upd")}` : ""}`,
    `${t(lang, "top_acc_public")} ${street} · ${t(lang, "top_acc_restricted")} ${kinds.info} · ${t(lang, "top_acc_web")} ${kinds.ok}`,
  ];
  if (pulse?.oom) lines.push("OOM");
  if (pulse?.failedUnit) lines.push(String(pulse.failedUnit));
  if (h.dockerSockWorld) lines.push(`docker.sock ${h.dockerSockMode || "open"}`);
  if (h.dockerPrivileged) lines.push("privileged ctr");
  if (h.sshPassword) lines.push(t(lang, "preview_ssh_pass"));
  const cms = Array.isArray(apps.cms) ? apps.cms.filter(Boolean).slice(0, 3).join(",") : "";
  if (cms) lines.push(cms);
  if (apps.mail?.kind) lines.push(String(apps.mail.kind));
  if (apps.vpn?.kind) lines.push(String(apps.vpn.kind));
  if (pulse?.limited) lines.push(t(lang, "preview_limited"));
  const miners = (pulse?.top || []).filter((r) => looksLikeMiner(r) && !isPulseHelper(r));
  if (miners.length) lines.push(t(lang, "top_miner_tag"));
  return lines.map((ln) => dim(ln));
}

function listenLines(pulse, lang, width, maxRows) {
  const out = [bold(t(lang, "top_listen"))];
  const listen = collapseListen([...(pulse?.listen || [])]).sort((a, b) => {
    const rank = (addr) =>
      addr === "0.0.0.0" || addr === "::" || addr === "*" ? 0 : String(addr).startsWith("127.") || addr === "::1" ? 2 : 1;
    return rank(a.addr) - rank(b.addr) || Number(a.port) - Number(b.port);
  });
  const cap = Math.max(4, maxRows - 1);
  const rows = listen.slice(0, cap);
  if (!rows.length) {
    out.push(dim("  " + t(lang, "preview_none")));
    return out;
  }
  const addrW = Math.min(18, Math.max(9, Math.floor(width * 0.22)));
  const svcW = Math.min(16, Math.max(8, Math.floor(width * 0.22)));
  const commW = Math.min(16, Math.max(8, Math.floor(width * 0.2)));
  for (const r of rows) {
    const kind = listenAccessKind(r);
    const svc = serviceName(r.port) || r.comm || "—";
    const row = `  ${pad(r.addr || "—", addrW)} ${pad(String(r.port ?? ""), 5, { align: "right" })}  ${pad(svc, svcW)} ${pad(r.comm || "—", commW)} ${accessLabel(lang, kind)}`;
    if (kind === "risk") out.push(`\x1b[31m${row}\x1b[0m`);
    else if (kind === "warn") out.push(`\x1b[33m${row}\x1b[0m`);
    else out.push(row);
  }
  if (listen.length > rows.length) out.push(dim(`  +${listen.length - rows.length}`));
  return out.slice(0, maxRows);
}

function procLines(pulse, lang, width, maxRows) {
  const out = [bold(t(lang, "top_procs"))];
  const top = [...(pulse?.top || [])].filter((r) => !isPulseHelper(r));
  const cap = Math.max(4, maxRows - 1);
  const rows = top.slice(0, cap);
  if (!rows.length) {
    out.push(dim("  " + t(lang, "preview_none")));
    return out;
  }
  const nameW = Math.min(22, Math.max(10, Math.floor(width * 0.28)));
  const barW = Math.max(8, Math.min(28, width - nameW - 18));
  for (const r of rows) {
    const tag = looksLikeMiner(r)
      ? ` ${t(lang, "top_miner_tag")}`
      : hotFromTop([r], pulse?.memTotal).length
        ? ` ${t(lang, "top_hot_tag")}`
        : "";
    out.push(
      `  ${pad(r.comm || "—", nameW)} ${pad(`${r.cpuPct}%`, 5, { align: "right" })}  ${bar(r.cpuPct, barW)}  ${pad(`${r.rssMb}M`, 6, { align: "right" })}${tag}`
    );
  }
  if (top.length > rows.length) out.push(dim(`  +${top.length - rows.length}`));
  return out.slice(0, maxRows);
}

function zipColumns(left, right, cols, leftW) {
  const mid = Math.max(8, Math.min(Math.floor(Number(leftW) || cols / 2), cols - 12));
  const n = Math.max(left.length, right.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${pad(left[i] || "", mid)} ${pad(right[i] || "", cols - mid - 1)}`);
  }
  return out;
}

/**
 * One screen of live data. Pure string — easy to test.
 */
export function formatTopScreen(pulse, lang = "en", opts = {}) {
  const { now = Date.now(), intervalSec = 2, version = "", cols: colsOpt, rows: rowsOpt, cpuPcts: cpuOpt, uptimeSec = 0 } = opts;
  const cols = Math.max(60, Math.min(240, Number(colsOpt) || 80));
  const rows = Math.max(16, Math.min(80, Number(rowsOpt) || 24));
  const grade = pulse?.gradeInside || gradeInside(pulse || {}) || "—";
  const clock = new Date(now).toLocaleTimeString(undefined, { hour12: false });
  const host = pulse?.hostname || "—";
  const ncpu = Math.max(1, Number(pulse?.pressure?.cpus) || 1);
  const cpuPcts =
    Array.isArray(cpuOpt) && cpuOpt.length
      ? cpuOpt.slice(0, 16)
      : [Math.min(100, ((Number(pulse?.load1) || 0) / ncpu) * 100)];
  const leftW = Math.max(38, Math.min(cols - 28, Math.floor(cols * 0.58)));
  const meters = [
    ...cpuMeterLines(cpuPcts, leftW),
    htopBar(t(lang, "top_mem"), memPct(pulse), `${gb(pulse?.memUsed)}/${gb(pulse?.memTotal)}G`, leftW),
    htopBar(t(lang, "top_dsk"), Number(pulse?.diskUsedPct) || 0, pulse?.diskUsedPct != null ? `${pulse.diskUsedPct}%` : "—", leftW),
  ];
  const info = infoLines(pulse, lang, { uptimeSec });
  const headLeft = `${bold(t(lang, "top_title"))}  ${t(lang, "top_grade")} ${gradePaint(grade)}  ${host}`;
  const headRight = dim([clock, t(lang, "top_refresh", { sec: intervalSec }), version || ""].filter(Boolean).join("  "));
  const headGap = Math.max(1, cols - visLen(headLeft) - visLen(headRight));
  const head =
    visLen(headLeft) + 1 + visLen(headRight) <= cols
      ? `${headLeft}${" ".repeat(headGap)}${headRight}`
      : clipLine(`${headLeft}  ${headRight}`, cols);
  const lines = [head, ...zipColumns(meters, info, cols, leftW), ""];
  const footer = [dim(t(lang, "top_footer")), dim(t(lang, "top_keys"))];
  const bodyBudget = Math.max(8, rows - footer.length - lines.length);
  const wide = cols >= 108;
  if (wide) {
    const half = Math.floor(cols / 2) - 1;
    lines.push(...zipColumns(listenLines(pulse, lang, half, bodyBudget), procLines(pulse, lang, half, bodyBudget), cols));
  } else {
    const listenN = Math.max(5, Math.floor(bodyBudget * 0.55));
    const procN = Math.max(4, bodyBudget - listenN - 1);
    lines.push(...listenLines(pulse, lang, cols, listenN));
    lines.push("");
    lines.push(...procLines(pulse, lang, cols, procN));
  }
  while (lines.length < rows - footer.length) lines.push("");
  const fitted = lines.slice(0, rows - footer.length).map((ln) => clipLine(ln, cols));
  return [...fitted, ...footer.map((ln) => clipLine(ln, cols))].join("\n") + "\n";
}

function withLoadavg(pulse) {
  const avg = os.loadavg();
  return { ...pulse, load1: pulse?.load1 ?? avg[0], load5: avg[1], load15: avg[2] };
}

/**
 * Full-screen refresh loop. Resolves when user quits (q / Ctrl+C) or once=true.
 */
export async function runLiveTop({
  lang = "en",
  intervalSec = 2,
  once = false,
  grants = null,
  version = "",
  collect = () => collectPulse({ grants }),
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  const sec = topIntervalSec(intervalSec);
  const tty = Boolean(stdin.isTTY && stdout.isTTY && typeof stdin.setRawMode === "function");
  const history = { load: [], ram: [], disk: [] };

  const paint = () => {
    const pulse = withLoadavg(collect() || {});
    pushTopSample(history, pulse);
    const cpu = cpuTick(history.cpuSnap);
    history.cpuSnap = cpu.snap;
    const { cols, rows } = termSize(stdout);
    const frame = formatTopScreen(pulse, lang, {
      intervalSec: sec,
      version,
      cols,
      rows,
      history,
      cpuPcts: cpu.pcts,
      uptimeSec: os.uptime(),
    });
    if (!tty) {
      stdout.write(frame);
      return;
    }
    const lines = frame.replace(/\n$/, "").split("\n").slice(0, rows);
    let out = "\x1b[H";
    for (let i = 0; i < lines.length; i++) {
      out += clipLine(lines[i], cols) + "\x1b[K";
      if (i < lines.length - 1) out += "\n";
    }
    out += "\x1b[J";
    stdout.write(out);
  };

  if (once || !tty) {
    paint();
    return { mode: once || !tty ? "once" : "live" };
  }

  stdin.setRawMode(true);
  if (stdin.isPaused?.()) stdin.resume();
  stdout.write("\x1b[?1049h\x1b[?25l");

  return await new Promise((resolve) => {
    let seq = "";
    let escTimer = null;
    let timer = null;
    const onResize = () => paint();
    const cleanup = (code = 0) => {
      clearTimeout(escTimer);
      clearInterval(timer);
      stdin.off("data", onData);
      stdout.off?.("resize", onResize);
      process.off("SIGWINCH", onResize);
      try {
        stdin.setRawMode(false);
      } catch {
        /* cooked */
      }
      try {
        stdin.pause?.();
      } catch {
        /* ignore */
      }
      stdout.write("\x1b[?25h\x1b[?1049l");
      resolve({ mode: "live", exit: code });
    };
    const onData = (chunk) => {
      seq += Buffer.from(chunk).toString("utf8");
      clearTimeout(escTimer);
      while (seq) {
        if (incompleteEscape(seq)) {
          escTimer = setTimeout(() => {
            seq = "";
          }, 50);
          return;
        }
        let take = seq;
        let rest = "";
        if (seq.startsWith("\u001b") && seq.length >= 3) {
          take = seq.slice(0, 3);
          rest = seq.slice(3);
        } else {
          take = seq[0];
          rest = seq.slice(1);
        }
        seq = rest;
        if (take === "q" || take === "Q") {
          cleanup(0);
          return;
        }
        const key = parseMenuKey(take);
        if (key === "ctrl-c") {
          cleanup(130);
          return;
        }
      }
    };
    stdin.on("data", onData);
    if (typeof stdout.on === "function") stdout.on("resize", onResize);
    process.on("SIGWINCH", onResize);
    paint();
    timer = setInterval(paint, sec * 1000);
  });
}

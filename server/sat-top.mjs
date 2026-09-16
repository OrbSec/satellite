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

const SPARK = "▁▂▃▄▅▆▇█";
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
  const plain = str.replace(/\x1b\[[0-9;]*m/g, "");
  return plain.slice(0, Math.max(0, n));
}

export function bar(pct, width = 10) {
  const w = Math.max(4, Math.floor(Number(width) || 0));
  const n = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((n / 100) * w);
  return "█".repeat(filled) + "░".repeat(Math.max(0, w - filled));
}

export function sparkline(values, width) {
  const w = Math.max(2, Math.min(120, Math.floor(Number(width) || 0)));
  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return dim("·".repeat(w));
  const slice = nums.length > w ? nums.slice(nums.length - w) : nums;
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  const span = max - min || 1;
  const chars = slice.map((v) => SPARK[Math.min(7, Math.max(0, Math.round(((v - min) / span) * 7)))]);
  return dim("·".repeat(Math.max(0, w - chars.length))) + chars.join("");
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
  const cols = Math.max(60, Math.min(240, Number(stdout?.columns) || 80));
  const rows = Math.max(16, Math.min(80, Number(stdout?.rows) || 24));
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

function meterLine(label, value, pct, spark, cols) {
  const left = `${label} ${value}  `;
  const sparkW = Math.min(28, Math.max(8, Math.floor(cols * 0.22)));
  const barW = Math.max(8, cols - visLen(left) - sparkW - 1);
  return `${left}${bar(pct, barW)} ${sparkline(spark, sparkW)}`;
}

function postureLine(pulse, lang) {
  const h = pulse?.hardening || {};
  const apps = pulse?.apps || {};
  const bits = [`${t(lang, "preview_row_fw")} ${h.firewall || t(lang, "preview_fw_no")}`, h.fail2ban || t(lang, "preview_ban_no")];
  if (pulse?.limited) bits.push(t(lang, "preview_limited"));
  if (h.dockerSockWorld) bits.push(`docker.sock ${h.dockerSockMode || "open"}`);
  if (h.dockerPrivileged) bits.push("privileged ctr");
  const cms = Array.isArray(apps.cms) ? apps.cms.filter(Boolean).slice(0, 3).join(",") : "";
  if (cms) bits.push(cms);
  if (apps.mail?.kind) bits.push(String(apps.mail.kind));
  if (apps.vpn?.kind) bits.push(String(apps.vpn.kind));
  return dim(bits.join(" · "));
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
    out.push(
      `  ${pad(r.addr || "—", addrW)} ${pad(String(r.port ?? ""), 5, { align: "right" })}  ${pad(svc, svcW)} ${pad(r.comm || "—", commW)} ${accessLabel(lang, kind)}`
    );
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

function zipColumns(left, right, cols) {
  const mid = Math.floor(cols / 2) - 1;
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
  const { now = Date.now(), intervalSec = 2, version = "", cols: colsOpt, rows: rowsOpt, history = null } = opts;
  const cols = Math.max(60, Math.min(240, Number(colsOpt) || 80));
  const rows = Math.max(16, Math.min(80, Number(rowsOpt) || 24));
  const grade = pulse?.gradeInside || gradeInside(pulse || {}) || "—";
  const clock = new Date(now).toLocaleTimeString(undefined, { hour12: false });
  const host = pulse?.hostname || "—";
  const l1 = Number.isFinite(Number(pulse?.load1)) ? Number(pulse.load1).toFixed(2) : "—";
  const l5 = Number.isFinite(Number(pulse?.load5)) ? Number(pulse.load5).toFixed(2) : null;
  const l15 = Number.isFinite(Number(pulse?.load15)) ? Number(pulse.load15).toFixed(2) : null;
  const loadTxt = l5 && l15 ? `${l1} ${dim(`${l5} ${l15}`)}` : l1;
  const ram = `${gb(pulse?.memUsed)}/${gb(pulse?.memTotal)}G`;
  const disk = pulse?.diskUsedPct != null ? `${pulse.diskUsedPct}%` : "—";
  const hist = history || { load: [], ram: [], disk: [] };
  const head = `${bold(t(lang, "top_title"))}  ${host}  ${t(lang, "top_grade")} ${gradePaint(grade)}  ${dim(clock)}  ${dim(t(lang, "top_refresh", { sec: intervalSec }))}${version ? dim(`  ${version}`) : ""}`;
  const lines = [
    pad(head, cols),
    meterLine(t(lang, "top_load"), loadTxt, Math.min(100, Number(pulse?.load1) * 25), hist.load, cols),
    meterLine(t(lang, "top_ram"), ram, memPct(pulse), hist.ram, cols),
    meterLine(t(lang, "top_disk"), disk, Number(pulse?.diskUsedPct) || 0, hist.disk, cols),
    pad(postureLine(pulse, lang), cols),
    "",
  ];
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
  const fitted = lines.slice(0, rows - footer.length);
  return [...fitted, ...footer].join("\n") + "\n";
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
    const { cols, rows } = termSize(stdout);
    const frame = formatTopScreen(pulse, lang, { intervalSec: sec, version, cols, rows, history });
    if (tty) stdout.write("\x1b[2J\x1b[H");
    stdout.write(frame);
  };

  if (once || !tty) {
    paint();
    return { mode: once || !tty ? "once" : "live" };
  }

  stdin.setRawMode(true);
  if (stdin.isPaused?.()) stdin.resume();
  stdout.write("\x1b[?25l");

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
      stdout.write("\x1b[?25h\n");
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

/**
 * Live perimeter view for `orb44 top`.
 * Free CLI only: current snapshot — no history, Watch, or street delta.
 */
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

function bar(pct, width = 10) {
  const n = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((n / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
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

/** Same access classes as the dashboard listen table (labels only — no history). */
export function listenAccessKind(r) {
  const addr = String(r.addr || "");
  const local = addr === "127.0.0.1" || addr === "::1" || addr.startsWith("127.");
  const all = addr === "0.0.0.0" || addr === "::" || addr === "*";
  const admin = new Set([
    2019, 2375, 2376, 3306, 5432, 6379, 27017, 9200, 11211, 15672, 8500, 2379, 6443, 9090, 5601, 7474, 7687, 1080, 6432,
    11434, 6333, 19530, 9229, 9222,
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

function pad(s, n) {
  const str = String(s ?? "");
  if (str.length >= n) return str.slice(0, n);
  return str + " ".repeat(n - str.length);
}

function padL(s, n) {
  const str = String(s ?? "");
  if (str.length >= n) return str.slice(0, n);
  return " ".repeat(n - str.length) + str;
}

export function topIntervalSec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(30, Math.round(n)));
}

/**
 * One screen of live data. Pure string — easy to test.
 */
export function formatTopScreen(pulse, lang = "en", { now = Date.now(), intervalSec = 2, version = "" } = {}) {
  const h = pulse?.hardening || {};
  const grade = pulse?.gradeInside || gradeInside(pulse || {}) || "—";
  const clock = new Date(now).toLocaleTimeString(undefined, { hour12: false });
  const host = pulse?.hostname || "—";
  const load = Number.isFinite(Number(pulse?.load1)) ? Number(pulse.load1).toFixed(2) : "—";
  const ram = `${gb(pulse?.memUsed)}/${gb(pulse?.memTotal)}G`;
  const disk = pulse?.diskUsedPct != null ? `${pulse.diskUsedPct}%` : "—";
  const fw = h.firewall || t(lang, "preview_fw_no");
  const ban = h.fail2ban || t(lang, "preview_ban_no");
  const lines = [];

  lines.push(
    `${bold(t(lang, "top_title"))}  ${host}  ${t(lang, "top_grade")} ${gradePaint(grade)}  ${dim(clock)}  ${dim(t(lang, "top_refresh", { sec: intervalSec }))}${version ? dim(`  ${version}`) : ""}`
  );
  lines.push(
    `${t(lang, "top_load")} ${load}  ${bar(Math.min(100, Number(pulse?.load1) * 25), 8)}  ${t(lang, "top_ram")} ${ram}  ${bar(memPct(pulse), 8)}  ${t(lang, "top_disk")} ${disk}  ${bar(Number(pulse?.diskUsedPct) || 0, 8)}`
  );
  lines.push(dim(`${t(lang, "preview_row_fw")} ${fw} · ${ban}${pulse?.limited ? " · " + t(lang, "preview_limited") : ""}`));
  lines.push("");

  lines.push(bold(t(lang, "top_listen")));
  const listen = collapseListen([...(pulse?.listen || [])])
    .sort((a, b) => {
      const rank = (addr) =>
        addr === "0.0.0.0" || addr === "::" || addr === "*" ? 0 : String(addr).startsWith("127.") || addr === "::1" ? 2 : 1;
      return rank(a.addr) - rank(b.addr) || Number(a.port) - Number(b.port);
    })
    .slice(0, 14);
  if (!listen.length) {
    lines.push(dim("  " + t(lang, "preview_none")));
  } else {
    for (const r of listen) {
      const kind = listenAccessKind(r);
      const svc = serviceName(r.port) || r.comm || "—";
      const acc = accessLabel(lang, kind);
      lines.push(
        `  ${pad(r.addr || "—", 15)} ${padL(String(r.port ?? ""), 5)}  ${pad(svc, 14)} ${pad(r.comm || "—", 12)} ${acc}`
      );
    }
  }
  lines.push("");

  lines.push(bold(t(lang, "top_procs")));
  const top = [...(pulse?.top || [])].filter((r) => !isPulseHelper(r)).slice(0, 10);
  if (!top.length) {
    lines.push(dim("  " + t(lang, "preview_none")));
  } else {
    for (const r of top) {
      const tag = looksLikeMiner(r) ? ` ${t(lang, "top_miner_tag")}` : hotFromTop([r], pulse?.memTotal).length ? ` ${t(lang, "top_hot_tag")}` : "";
      lines.push(
        `  ${pad(r.comm || "—", 16)} ${padL(`${r.cpuPct}%`, 5)}  ${bar(r.cpuPct, 12)}  ${padL(`${r.rssMb}M`, 6)}${tag}`
      );
    }
  }

  lines.push("");
  lines.push(dim(t(lang, "top_footer")));
  lines.push(dim(t(lang, "top_keys")));
  return lines.join("\n") + "\n";
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

  const paint = () => {
    const pulse = collect();
    const frame = formatTopScreen(pulse, lang, { intervalSec: sec, version });
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
    const cleanup = (code = 0) => {
      clearTimeout(escTimer);
      clearInterval(timer);
      stdin.off("data", onData);
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
    paint();
    timer = setInterval(paint, sec * 1000);
  });
}

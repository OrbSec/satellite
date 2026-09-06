export function incompleteEscape(seq) {
  return seq === "\u001b" || seq === "\u001b[" || seq === "\u001bO";
}

export function parseMenuKey(raw) {
  const s = typeof raw === "string" ? raw : Buffer.from(raw || "").toString("utf8");
  if (s === "\u0003") return "ctrl-c";
  if (s === "\r" || s === "\n") return "enter";
  if (s === "\u001b[A" || s === "\u001bOA" || s === "k" || s === "K") return "up";
  if (s === "\u001b[B" || s === "\u001bOB" || s === "j" || s === "J") return "down";
  if (incompleteEscape(s)) return "esc-wait";
  if (/^[1-9]$/.test(s)) return { digit: Number(s) };
  return null;
}

export function moveIndex(i, dir, n) {
  if (!n) return 0;
  if (dir === "up") return (i + n - 1) % n;
  if (dir === "down") return (i + 1) % n;
  return i;
}

function paint(stdout, items, index, hint) {
  const n = items.length + (hint ? 1 : 0);
  stdout.write(`\x1b[${n}A`);
  for (let i = 0; i < items.length; i++) {
    const cur = i === index;
    const mark = cur ? "▸" : " ";
    const body = cur ? `\x1b[1m${items[i]}\x1b[0m` : items[i];
    stdout.write(`\x1b[2K  ${mark} ${body}\n`);
  }
  if (hint) stdout.write(`\x1b[2K\x1b[2m${hint}\x1b[0m\n`);
}

export async function pickFromList({
  title,
  items,
  index = 0,
  hint = "↑↓  Enter",
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  if (!items?.length) return 0;
  let i = Math.max(0, Math.min(items.length - 1, Number(index) || 0));
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") return i;

  stdout.write(`\n${title}\n\n`);
  for (let k = 0; k < items.length; k++) {
    const cur = k === i;
    stdout.write(`  ${cur ? "▸" : " "} ${cur ? `\x1b[1m${items[k]}\x1b[0m` : items[k]}\n`);
  }
  if (hint) stdout.write(`\x1b[2m${hint}\x1b[0m\n`);

  stdin.setRawMode(true);
  if (stdin.isPaused?.()) stdin.resume();
  stdout.write("\x1b[?25l");

  return await new Promise((resolve) => {
    let seq = "";
    let escTimer = null;
    const finish = (fn) => {
      clearTimeout(escTimer);
      stdin.off("data", onData);
      try {
        stdin.setRawMode(false);
      } catch {
        /* already cooked */
      }
      try {
        stdin.pause?.();
      } catch {
        /* ignore */
      }
      stdout.write("\x1b[?25h");
      fn();
    };
    const applyKey = (key) => {
      if (!key || key === "esc-wait") return false;
      if (key === "ctrl-c") {
        finish(() => {
          stdout.write("\n");
          process.exit(130);
        });
        return true;
      }
      if (key === "up" || key === "down") {
        i = moveIndex(i, key, items.length);
        paint(stdout, items, i, hint);
        return false;
      }
      if (key === "enter") {
        finish(() => {
          stdout.write("\n");
          resolve(i);
        });
        return true;
      }
      if (key?.digit >= 1 && key.digit <= items.length) {
        i = key.digit - 1;
        finish(() => {
          stdout.write("\n");
          resolve(i);
        });
        return true;
      }
      return false;
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
        } else if (!seq.startsWith("\u001b")) {
          take = seq[0];
          rest = seq.slice(1);
        }
        seq = rest;
        if (applyKey(parseMenuKey(take))) return;
      }
    };
    stdin.on("data", onData);
  });
}

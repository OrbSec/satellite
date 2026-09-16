/** Timer/cron names that look like backup tools. Insight only — not proof of restore. */

const BACKUP_RE = /\b(restic|borgmatic|borg|rclone|duplicity|rsnapshot|rdiff-backup|proxmox-backup|veeam|acronis|duplicati)\b/i;

export function parseBackupHints({ timers = "", crontab = "", units = "" } = {}) {
  const blob = [timers, crontab, units].join("\n");
  const tools = [...new Set([...blob.matchAll(new RegExp(BACKUP_RE, "gi"))].map((m) => String(m[1]).toLowerCase()))];
  const names = blob
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => BACKUP_RE.test(l))
    .slice(0, 8);
  return { tools, names, present: tools.length > 0 };
}

# @orb44/cli

[Orb44](https://orb44.com) Watch **satellite** — inside pulse from your VPS (load, listeners, hardening, Docker posture), paired with the outside snapshot in the dashboard. The dashboard does **not** run commands on the machine.

| | |
|---|---|
| Product | [orb44.com](https://orb44.com) |
| Dashboard | [app.orb44.com](https://app.orb44.com) |
| npm | [@orb44/cli](https://www.npmjs.com/package/@orb44/cli) |
| Source | [github.com/OrbSec/satellite](https://github.com/OrbSec/satellite) |
| Security | [SECURITY.md](https://github.com/OrbSec/satellite/blob/main/SECURITY.md) · Cosign-signed GitHub Releases |
| License | MIT |

Node 18+. Linux or macOS. Current release: **0.1.24**.

## Live view (no login)

Perimeter snapshot on this box — load, RAM, disk, listeners with access labels, process top. **Live only**: no history, no Watch alerts, no street delta (those are on the paid plan).

```bash
npx @orb44/cli@0.1.24 top
npx @orb44/cli@0.1.24 top --interval 1
npx @orb44/cli@0.1.24 top --once    # one frame, then exit
```

Keys: `q` quit · `Ctrl+C`.

## Pair with the dashboard

```bash
npx @orb44/cli@0.1.24 login --url https://app.orb44.com
```

Open the printed link while signed into the dashboard, confirm the domain, then optionally install the systemd daemon (default: no on `login`).

`install` on a TTY asks: Watch daemon (default yes), error-log tail (default no), then optional read access for fail2ban / Docker / journal. `--daemon` `--logs` `--fail2ban` `--docker` `--journal` `--access` skip those questions.

```bash
npx @orb44/cli@0.1.24 status
npx @orb44/cli@0.1.24 pulse
npx @orb44/cli@0.1.24 install
orb44 update
npx @orb44/cli@0.1.24 logout
```

Do **not** run bare `npx @orb44/cli` — caches go stale. Pin the version or use `orb44` after install.

`orb44 update` downloads the latest `@orb44/cli` tarball from npm and checks it against `dist.integrity` / `dist.shasum` (allowlisted SHA) **before** unpack.

Device key: `~/.config/orb44/device.json` (mode `0600`). Not a shell token.

## Commands

```
orb44 login [--url …] [--daemon] [--logs] [--force] [--lang en|ru|ko|es]
orb44 top [--interval 2] [--once]
orb44 pulse
orb44 daemon [--interval 300]
orb44 install [--system] [--daemon] [--logs] [--fail2ban] [--docker] [--journal] [--access]
orb44 uninstall [--purge]
orb44 lang [en|ru|ko|es]
orb44 status
orb44 version
orb44 update
orb44 logout
```

Language: `--lang`, `ORB44_LANG`, or a prompt on first login (`en` `ru` `ko` `es`).

## What a pulse includes

Read-only. No full cmdline, env, or application config files.

- Load, RAM, disk, process top (basename only)
- Listeners (loopback vs world; dual-stack `0.0.0.0`+`::` collapsed to `*`)
- Hardening: firewall, fail2ban jails, SSH, timesync, AppArmor/SELinux, reboot-required, OOM
- Docker when the socket is readable: `docker.sock` mode, members of group `docker`, privileged / host-root mounts, running image tag vs a small CVE catalog, container miner heuristic
- Apps on disk: CMS path markers (WordPress / Bitrix / Drupal / Joomla), mail (queue / open relay), VPN (WireGuard / OpenVPN / IPsec vs PPTP)
- Optional `--logs`: short error tails from journal / Docker / `kubectl get pods` / nginx — secrets stripped

Machine grade A–D is computed **on the dashboard**. It does not replace the street snapshot.

## What it never does

- Accept commands from the cloud (advice in the dashboard is text only)
- Dump databases, read `wp-config` / `.env` / `/etc/shadow`
- Inspect container `Env`, run `kubectl logs` / `exec`, pull images, or scan layers
- Enable ufw or edit sshd from the cabinet

After a pulse, open continuous monitoring in the dashboard: **https://app.orb44.com**

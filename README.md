# @orb44/cli

[Orb44](https://orb44.com) Watch **satellite** — inside pulse from your VPS (load, listeners, hardening), paired with the outside snapshot in the dashboard. The dashboard does **not** run commands on the machine.

| | |
|---|---|
| Product | [orb44.com](https://orb44.com) |
| Dashboard | [app.orb44.com](https://app.orb44.com) |
| Source | [github.com/OrbSec/satellite](https://github.com/OrbSec/satellite) |
| Security | [SECURITY.md](https://github.com/OrbSec/satellite/blob/main/SECURITY.md) · Cosign-signed GitHub Releases |
| License | MIT |

Node 18+. Linux or macOS.

## Live view (no login)

Perimeter snapshot on this box — load, RAM, disk, listeners with access labels, process top. **Live only**: no history, no Watch alerts, no street delta (those are on the paid plan).

```bash
npx @orb44/cli@0.1.20 top
npx @orb44/cli@0.1.20 top --interval 1
npx @orb44/cli@0.1.20 top --once    # one frame, then exit
```

Keys: `q` quit · `Ctrl+C`.

## Pair with the dashboard

```bash
npx @orb44/cli@0.1.20 login --url https://app.orb44.com
```

Open the printed link while signed into the dashboard, confirm the domain, then optionally install the systemd daemon (default: no).

```bash
npx @orb44/cli@0.1.20 status
npx @orb44/cli@0.1.20 pulse
npx @orb44/cli@0.1.20 install
orb44 update
npx @orb44/cli@0.1.20 logout
```

Do **not** run bare `npx @orb44/cli` — caches go stale. Pin the version or use `orb44` after install.

Device key: `~/.config/orb44/device.json` (mode `0600`). Not a shell token.

After a pulse, open continuous monitoring in the dashboard: **https://app.orb44.com**

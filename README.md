# @orb44/cli

[Orb44](https://orb44.com) Watch **satellite** — inside pulse from your VPS (load, listeners, hardening), paired with the outside snapshot in the dashboard. The dashboard does **not** run commands on the machine.

| | |
|---|---|
| Product | [orb44.com](https://orb44.com) |
| Cabinet | [app.orb44.com](https://app.orb44.com) |
| Source | [github.com/OrbSec/satellite](https://github.com/OrbSec/satellite) |
| Security | [SECURITY.md](https://github.com/OrbSec/satellite/blob/main/SECURITY.md) · Cosign-signed GitHub Releases |
| License | MIT |

Node 18+. Linux or macOS.

## Install (pin a version)

```bash
npx @orb44/cli@0.1.17 login --url https://app.orb44.com
```

Open the printed link while signed into the dashboard, confirm the domain, then optionally install the systemd daemon (default: no).

```bash
npx @orb44/cli@0.1.17 status
npx @orb44/cli@0.1.17 pulse
npx @orb44/cli@0.1.17 install
orb44 update
npx @orb44/cli@0.1.17 logout
```

Do **not** run bare `npx @orb44/cli` — caches go stale. Pin the version or use `orb44` after install.

Device key: `~/.config/orb44/device.json` (mode `0600`). Not a shell token.

After a pulse, open continuous monitoring in the dashboard: **https://app.orb44.com**

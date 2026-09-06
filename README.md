# Orb44 Watch satellite

> Inside pulse from **your** VPS: load, listeners, hardening — paired with the street snapshot in the [Orb44](https://orb44.com) cabinet.

This repository is the open surface of **`@orb44/cli`**: the optional agent you install on a machine you own or administer. It does **not** run remote shells, does **not** dump databases, and does **not** accept inbound commands from the cloud. The cabinet only receives the pulse you send.

| | |
|---|---|
| Product | [orb44.com](https://orb44.com) |
| Cabinet | [app.orb44.com](https://app.orb44.com) |
| npm | [`@orb44/cli`](https://www.npmjs.com/package/@orb44/cli) |
| License | MIT |

## Why a satellite

Orb44’s street view sees what a passerby sees. Bind addresses on `127.0.0.1`, load spikes, failed units, and “Redis on all interfaces” are invisible from outside. One device on the host closes that gap and lands on the **same card** as the street grade.

## Install (pin a version)

```bash
# Node 18+ · Linux or macOS
npx @orb44/cli@0.1.12 login --url https://app.orb44.com
```

Open the printed link while signed into the cabinet, confirm the domain, then optionally install the systemd daemon (default: no).

```bash
npx @orb44/cli@0.1.12 status
npx @orb44/cli@0.1.12 pulse
npx @orb44/cli@0.1.12 install   # daemon? (default yes) · logs? (default no)
orb44 update                    # after global install
npx @orb44/cli@0.1.12 logout
```

Do **not** run bare `npx @orb44/cli` — caches go stale. Pin the version or use `orb44` after install.

Device key: `~/.config/orb44/device.json` (mode `0600`). Revocable from the cabinet and from the CLI. Not a shell token.

## What the pulse contains

- Load / RAM / disk pressure  
- Listening sockets (`0.0.0.0` vs loopback) when visible without root  
- Hardening hints (firewall / auto-updates / time sync) when detectable  
- Optional short error tails only if you grant `logs` at login  

The cabinet replies with **advice text** only. It never executes commands on your machine.

## Continuous monitoring

Pair the satellite with **Watch** in the cabinet for change tracking and alerts (Telegram today; Slack on the roadmap). Street + machine on one card — not an enterprise VM suite, not a PCI certificate.

## Security

See [SECURITY.md](./SECURITY.md). Releases published from this repository are intended to be **Cosign-signed** via GitHub Actions (keyless OIDC). Verify before you trust a tarball on a production host.

## What this is not

- Not a licensed pentest  
- Not Nuclei / full DAST  
- Not a WAF or CDN  
- Not AI-code / repository SAST  

## Lead home

After a local pulse, open the cabinet for graphs, history, and alerts:

**https://app.orb44.com**

Questions: admin@orb44.com

# Security Policy

## Supported versions

| Component | Supported |
|-----------|-----------|
| `@orb44/cli` current npm release | Yes |
| GitHub `main` / tagged releases in this repo | Yes |
| Forks / unofficial builds | No — treat as untrusted |

## What this agent is allowed to do

- Collect a **read-only pulse** on the host where you installed it (load, listeners when visible, hardening signals).  
- Send that pulse **outbound** to your Orb44 cabinet URL.  
- Store a **device key** under `~/.config/orb44/` with mode `0600`.

## What it must never do

- Accept inbound shell / RPC from the cloud  
- Run arbitrary commands returned by the cabinet (advice is text only)  
- Dump databases, read application secrets from disk, or escalate privileges for “deeper” scans  
- Brute-force credentials or mutate the customer’s edge config

If you observe behavior that contradicts this, treat it as a vulnerability.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Email: **admin@orb44.com**  
Subject: `SECURITY @orb44/cli` (or `SECURITY satellite`)

Include:

1. Affected version / commit / npm tarball URL  
2. Reproduction steps on a throwaway host  
3. Impact (e.g. unexpected outbound data, privilege use, supply-chain concern)  
4. Whether you need coordinated disclosure timing  

We aim to acknowledge within **3 business days** and to ship a fix or mitigation for confirmed issues as quickly as practical.

## Verifying releases

Prefer installing from npm with a **pinned version**:

```bash
npx @orb44/cli@0.1.12 --help
```

GitHub Release assets (when published from this repository) should carry **Cosign** signatures produced by GitHub Actions OIDC (keyless). Example verification once a release exists:

```bash
cosign verify-blob \
  --certificate-identity-regexp 'https://github.com/.*/satellite/\.github/workflows/release\.yml@.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --signature orb44-cli.sig \
  orb44-cli.tgz
```

(Exact identity regexp may match the publishing workflow path — check the release notes.)

## Supply chain

- Runtime: **no npm dependencies** by design (`package.json` must stay dependency-free).  
- Updates: `orb44 update` pulls a versioned tarball for `@orb44/cli`; avoid unpinned `npx @orb44/cli` without a version.  
- Device key compromise: revoke the satellite in the cabinet and run `orb44 logout` on the host.

## Safe harbor

Research on **your own** hosts or with **written authorization** only. Do not use Orb44 tooling against third-party systems without permission.

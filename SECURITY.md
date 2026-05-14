# Security Policy

## Supported versions

While the package is in `0.x`, only the latest minor release receives
security fixes. Once `1.0` ships, this policy will widen.

| Version | Supported |
|---------|-----------|
| `0.1.x` | ✅        |
| `< 0.1` | ❌        |

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Email `security@p2p.me` with:

- A clear description of the issue and the impact.
- Steps to reproduce (or a minimal proof-of-concept).
- The widget version, peer-dep versions, and chain ID where applicable.

We aim to acknowledge reports within 2 business days and ship a fix or
mitigation plan within 14 days for high-severity issues. Coordinated
disclosure is welcome — let us know if you have a preferred window.

## Scope

In scope:

- The `@p2pdotme/widgets` package code (the widgets, the state
  machines, the error system, the contract helpers).
- The examples in `examples/`.
- Anything that could let an attacker:
  - exfiltrate the user's payment address before encryption,
  - bypass the credit-aware concurrency gate,
  - render a misleading on-screen quote (price / fee / amount),
  - poison the revert selector registry to mis-label a real revert.

Out of scope:

- The underlying P2P Diamond / integrator contracts — report those to the
  contracts repo's security contact.
- The fraud-engine API — report directly to the fraud-engine team.
- Issues in the `@p2pdotme/sdk` package itself (file at that repo).
- Vulnerabilities that require physical access to the user's device or
  control of the user's wallet.

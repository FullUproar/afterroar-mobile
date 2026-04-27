# afterroar-mobile

The phone-side of the Afterroar/Full Uproar platform. Capacitor-wrapped React apps for Android and (eventually) iOS.

## Apps

| Path | Purpose | Phase | Platforms |
|---|---|---|---|
| `apps/register` | Store Ops register — the offline-capable POS that protects the SLA promise | **First — currently in flight** | Android first → iOS in R3 |
| `apps/garmr` | Watchdog of the watchdog — phone-native uptime monitor that survives total cloud outage. Named after the Norse hellhound at Hel's gate. | Second | Android only (single-user, Shawn) |
| `apps/passport` | Consumer Passport app — push notifications, lock-screen presence, NFC/QR check-in at Connect stores, eventually Apple Wallet / Google Wallet pass | Third | Android first → iOS |

## Why these all live in one repo

The three apps share a meaningful amount of plumbing:
- Capacitor 6 + Vite + React + TS scaffolding
- Native plugin setup (push notifications, local notifications, network detection, secure storage)
- Android signing keys + Play Store listing flow
- Future iOS signing certs + provisioning profile dance
- Shared `@afterroar/client` SDK (federation API consumer) — installed as npm dep here, source of truth in the `afterroar` monorepo
- Design tokens / brand styling

Splitting them into three repos triples that infrastructure cost. Keeping them together means we pay it once.

## Layout

```
afterroar-mobile/
├── apps/
│   ├── register/       # POS (Phase 1)
│   ├── garmr/          # Watchdog (Phase 2)
│   └── passport/       # Consumer (Phase 3)
├── packages/
│   └── shared/         # Capacitor plugin config, design tokens, helpers shared across apps
├── docs/
│   ├── mobile-strategy.md           # Phasing, platforms, Mac/iPhone story
│   ├── register-offline-modes.md    # States A/B/C, offlinePaymentMode setting
│   ├── register-sync-architecture.md # Event-sourced sync, Lamport clocks, reconciliation
│   └── capacitor-setup.md           # Android Studio, signing, Play Store
├── CLAUDE.md           # Read first if you're a Claude/dev instance picking this up
└── README.md
```

## Quick orientation for a new machine

1. `git clone <repo>` somewhere under `c:\dev\FULL UPROAR PLATFORM\` to keep the platform layout consistent.
2. `npm install` at the repo root (workspaces).
3. Read `CLAUDE.md` for the platform map and trap paths.
4. Read `docs/mobile-strategy.md` for current phase + what's shipped.
5. App-specific dev: `cd apps/<app>; npm run dev` runs the Vite dev server in the browser. Native builds: see `docs/capacitor-setup.md`.

## Where this fits in the platform

The platform spans four core repos. See `CLAUDE.md` for the full map.

- **`afterroar`** — Store Ops + Passport server-side (apps/ops, apps/me)
- **`full-uproar-site`** — FU's customer-facing site + Game Night HQ (apps/site, apps/hq)
- **`afterroar-mobile`** — this repo — phone-side
- **legacy `ops-afterroar-store` (single-app, do not use)** — see CLAUDE.md trap-paths

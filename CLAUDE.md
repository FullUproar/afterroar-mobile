# afterroar-mobile — Claude / dev orientation

**Read me first.** If you're a Claude instance or a new contributor working in this repo, this file is the orientation. The wider platform context lives in the canonical [`FULL UPROAR PLATFORM/CLAUDE.md`](../CLAUDE.md) — that doc is the master map; this one is repo-local.

Last updated 2026-04-27.

## What's in this repo

Capacitor-wrapped React apps that run on phones. Three apps planned:

1. **`apps/register`** — Store Ops POS. Offline-capable, the SLA-protecting product moat. Phase 1 (in flight).
2. **`apps/garmr`** — Phone-native uptime monitor (named after the Norse hellhound). Single-user (Shawn). Phase 2.
3. **`apps/passport`** — Consumer Passport app. Push notifications, NFC check-in, wallet pass. Phase 3.

See [`docs/mobile-strategy.md`](docs/mobile-strategy.md) for the phasing rationale and current state.

## Platform map (cross-references)

The Afterroar/Full Uproar platform is multiple repos. This is one of them. Full map at [`FULL UPROAR PLATFORM/CLAUDE.md`](../CLAUDE.md). Quick version:

| Product | Domain | Repo | Local path |
|---|---|---|---|
| FU site (storefront, content) | www.fulluproar.com | `full-uproar-site` | `c:\dev\full-uproar-site` |
| Game Night HQ | hq.fulluproar.com | same monorepo, `apps/hq` | `c:\dev\full-uproar-site` |
| Store Ops (POS server) | www.afterroar.store | `afterroar` (monorepo, `apps/ops`) | `c:\dev\FULL UPROAR PLATFORM\ops-afterroar-store` |
| Passport (identity) | www.afterroar.me | same monorepo, `apps/me` | same |
| **Mobile (you are here)** | n/a (apps) | `afterroar-mobile` | `c:\dev\FULL UPROAR PLATFORM\afterroar-mobile` |

## Database topology

| Neon project | Endpoint | Used by |
|---|---|---|
| `neon-full-uproar` | `ep-crimson-surf-amyp1ski-pooler` | full-uproar-site, hq, marketing |
| `afterroar-pos-prod` | `ep-steep-king-amgsp5e4-pooler` | afterroar-ops, afterroar-me |

The mobile apps **never** connect directly to either Neon. Mobile apps speak to:
- The **federation API** at `afterroar.me/api/v1/*` (X-API-Key auth, scoped) for cross-app reads.
- The **Store Ops sync API** (TBD, lands in R2) for register event log push/pull.
- **Stripe Terminal SDK** directly on-device for card payments.

## Trap paths — DO NOT use

- `c:\dev\ops-afterroar-store` — legacy single-app `src/` layout, ~3 weeks stale. Has its own outdated Prisma schema. **Do not push schema changes from here** — already caused one production outage. Canonical is `c:\dev\FULL UPROAR PLATFORM\ops-afterroar-store`.
- `c:\dev\FULL UPROAR PLATFORM\full-uproar-site` — stale clone. Canonical is `c:\dev\full-uproar-site`.

## Tech stack (per app)

- **Vite + React 19 + TypeScript** — app code
- **Capacitor 6** — native wrapper for Android (and iOS later)
- **`@afterroar/client`** — federation API SDK, installed as npm dependency from the `afterroar` monorepo
- **Stripe Terminal SDK** (R3 only, via `@capacitor-community/stripe-terminal`) — card reader integration with offline payments
- **SQLite via `@capacitor-community/sqlite`** (R2 only) — local register event log + denormalized state cache
- **Capacitor plugins**: `@capacitor/preferences` (small KV), `@capacitor/network` (online/offline detection), `@capacitor/local-notifications` (Garmr alerts), `@capacitor/push-notifications` (Passport, eventually)

## Dev loop

Web-only iteration (fastest):

```bash
cd apps/<app>
npm run dev         # Vite dev server, browser
```

Native Android iteration (when testing Capacitor plugins / hardware):

```bash
cd apps/<app>
npm run build       # Build the React app
npx cap sync android
npx cap run android # Builds + installs on connected Android device
```

iOS: deferred to R3. Requires macOS + Xcode. See [`docs/capacitor-setup.md`](docs/capacitor-setup.md) for the path when we get there.

## Architecture docs in this repo

- [`docs/mobile-strategy.md`](docs/mobile-strategy.md) — phases, platforms, Mac/iPhone, what ships when
- [`docs/register-offline-modes.md`](docs/register-offline-modes.md) — states A/B/C and the per-store `offlinePaymentMode` setting
- [`docs/register-sync-architecture.md`](docs/register-sync-architecture.md) — event-sourced sync, Lamport clocks, conflict resolution, reconciliation queue
- [`docs/capacitor-setup.md`](docs/capacitor-setup.md) — Android Studio, signing keys, Play Store, future iOS

## Memory rules that apply here

(Same as elsewhere in the platform — see `~/.claude/projects/c--dev-FULL-UPROAR-PLATFORM/memory/`):

- **Never echo .env contents to chat.** Don't `cat`, `head`, `sed`, `awk` against `.env*` files. Use `grep -c` for presence-only checks. Same rule applies to **freshly minted secrets** — write them to a file the user opens manually, never to stdout.
- **UX enrichment principle**: user always knows what this is / can do / should do next, but via UX (empty states, progressive disclosure), not literal "click here" copy.

## When this doc goes stale

Verify with:
- `git remote -v` + `git log -1` in each candidate path
- `vercel project inspect <name>` for any deployed surface
- Read the most recent doc in `docs/` for current phase

Then update this file before continuing.

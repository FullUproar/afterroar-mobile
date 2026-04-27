# `@afterroar/garmr` — phone-native watchdog

> Garmr (pronounced GAR-mr) — the hellhound at the gates of Hel in Norse myth, who barks at the world's end.

A small Capacitor app that polls the 4 platform surfaces and alerts via local notification + haptic buzz when one goes down. Single-user (Shawn). Android-only.

## What it does

- Every 60 seconds, fetches `/api/health` on each of:
  - `afterroar.store` (Store Ops)
  - `afterroar.me` (Passport)
  - `hq.fulluproar.com` (Game Night HQ)
  - `fulluproar.com` (FU Site)
- Tracks consecutive-failure counts per surface.
- After **2 consecutive failures** (≈120 seconds), fires a local notification + heavy haptic buzz pattern.
- When the surface recovers, fires a recovery notification.
- Renders a small dashboard showing each surface's current status, latency, last check time.

## Why it exists

Platform-side monitoring (Sentry Uptime Monitors) is good but **shares a failure domain** with the things it monitors — when AWS / Vercel / Sentry have correlated outages, the alerts that should fire don't. Garmr runs on-device, polling from cellular if needed, so it survives total cloud-side outage.

It's the watchdog of the watchdog. Belt to Sentry's suspenders.

## Dev loop

```bash
# Web preview
npm run dev

# Build for Android (after npx cap add android once per machine)
npm run android:run        # build + sync + deploy to connected device
npm run android:open       # opens Android Studio at the project
```

## First-run flow

1. App requests notification permission. **Grant it** — without permission, alerts are visible-only on screen and useless when the phone is in your pocket.
2. App requests battery-optimization exemption (Android only). **Grant it.** Without this, Doze mode kills the polling timer when the screen is off and Garmr only barks while you're looking at it.
3. App keeps a foreground service alive while polling. Battery cost is small (~1% per day at 60s poll interval).

## Customizing

The 4 surfaces live in [`src/surfaces.ts`](src/surfaces.ts). Add a row to watch a new URL — no other change needed.

Poll interval (`POLL_INTERVAL_MS`) and failure threshold (`FAILURES_BEFORE_ALERT`) are constants in `App.tsx` and `alert.ts`. Defaults: 60s poll, 2 consecutive failures = alert.

## What it does NOT do

- Synthetic transactions (e.g. "create a fake order to verify checkout works"). Plain endpoint pings only.
- Track historical data — no SQLite, no charts. Just current state. Sentry holds the history.
- Cross-device alerts (only your phone). Single-user by design.
- iOS support (single-user, no business case for iOS yet).

## When to add more

If you'd rather have:
- Multiple recipients (cofounder, on-call rotation), → use Sentry's Slack/SMS integration; Garmr stays personal.
- Latency/perf budgets ("alert when p95 > 1s"), → Sentry Performance Monitor.
- Synthetic transaction tests, → Sentry has a feature for this; or Checkly is purpose-built.

Garmr is the "I'm Shawn and I want my phone to bark when something dies" tool. It deliberately doesn't try to be more.

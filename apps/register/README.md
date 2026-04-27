# `@afterroar/register` — Store Ops register, Android

Capacitor-wrapped POS app. R1 is a thin shell over the deployed web register; R2 replaces it with an offline-capable native implementation.

## Status

**R1 — Android only, online-only WebView wrapper.** Loads `https://www.afterroar.store/dashboard/register` inside the app. Same UX as the web register, but installable as an APK on the cashier's tablet.

R1 exists to prove the Capacitor + Android Studio + Play Store pipeline. **It does not protect against Store Ops outages.** That's R2's job.

## Dev loop

Web-only iteration (fastest, no Android Studio needed):

```bash
npm run dev
```

The shell page renders at `http://localhost:5173`. The Capacitor `server.url` setting only kicks in on a real device — in the browser you see the local shell.

## Building for Android

Prerequisites:
- Android Studio installed (Hedgehog or newer)
- An Android device with USB debugging enabled, OR an Android Studio emulator (Galaxy Tab profile recommended)
- JDK 17

First-time setup:

```bash
# From this directory
npm install
npx cap add android         # Generates the android/ folder
npm run build               # Build the React shell
npx cap sync android        # Copy build into Capacitor's Android project
npx cap open android        # Open Android Studio at this project
```

In Android Studio:
1. Wait for Gradle sync to complete (first time: 5–15 min on a fresh Android Studio install).
2. Connect a device via USB (with USB debugging enabled in Developer Options) or start an emulator.
3. Click ▶ Run.

Subsequent iterations:

```bash
npm run android:run         # Build + sync + deploy to connected device
```

Or for repeated UI changes without re-installing the APK:

```bash
npm run android:sync        # Build + copy into Android project; Android Studio picks up the change
```

## Android signing — first release prep

Not yet done. When R1 is ready to ship to Play Store internal testing track:

1. Generate a release keystore: `keytool -genkey -v -keystore register-release.keystore -alias register -keyalg RSA -keysize 4096 -validity 10000`
2. Store the keystore in 1Password + on encrypted external storage. **Never commit.**
3. Add `android/keystore.properties` with `storeFile`, `storePassword`, `keyAlias`, `keyPassword` — gitignored.
4. Configure `android/app/build.gradle` `signingConfigs.release` to read those.
5. Build signed AAB: `cd android && ./gradlew bundleRelease`.

See `../../docs/capacitor-setup.md` for details.

## Why a shell that just loads a URL?

R1 is intentionally minimal because:
- The Capacitor + Android Studio + signing + Play Store pipeline is the unknown we want to validate first.
- The actual product feature (offline mode) is R2's job.
- A throwaway shell is faster to scaffold than re-implementing the register from scratch.

The shell still serves a purpose post-R2 as the "boot screen" before the WebView (or, in R2, the native UI) takes over.

## Capacitor plugins included

- `@capacitor/app` — basic app lifecycle
- `@capacitor/network` — online/offline detection
- `@capacitor/status-bar` — Android status bar styling

R2 will add:
- `@capacitor-community/sqlite` — local event log + state cache
- `@capacitor-community/stripe-terminal` — card reader, offline payments

See `../../docs/register-sync-architecture.md` for what those plugins enable.

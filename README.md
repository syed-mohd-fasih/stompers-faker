<p align="center">
  <img src="assets/brand/icon-96.png" width="72" alt="" />
</p>

# Stompers Faker

Add steps to your phone's health data, so step games like **Stompers** count them. And take
them back out again whenever you want.

- **Android:** writes to Health Connect.
- **iPhone:** writes to Apple Health (in testing, see [iPhone](#iphone)).

Your real steps from other apps (Huawei Health, Samsung Health, the iPhone itself, …) are
**never changed**. The app only adds and removes its own entries.

## Install

### Android

1. You need **Health Connect** on the phone (built into Android 14+; on older phones,
   install the Health Connect app).
2. Download the latest `stompers-faker-vX.apk` from
   [Releases](https://github.com/syed-mohd-fasih/stompers-faker/releases/latest).
3. Open it and allow "Install unknown apps" for your browser or file manager when asked.
4. Open Stompers Faker → **Grant** → allow reading and writing Steps.

Updates: **Settings → Check for updates** downloads and installs new versions for you.
Your data and history are kept.

### iPhone

> **Still in testing.** It isn't confirmed yet that a free Apple Account can use Apple Health
> through sideloading. If the app can't get Health access after installing, that's why.

iPhones can't open app files like Android, so you install the app with a sideloading tool
that signs it with your own (free) Apple Account. Apps signed this way stop opening after
**7 days** unless they're refreshed, and you can have at most **3** sideloaded apps.

You need: an iPhone with a passcode (iOS 15 or newer for SideStore), your Apple Account,
Wi-Fi, a computer once for setup, and the latest `stompers-faker-vX.ipa` from
[Releases](https://github.com/syed-mohd-fasih/stompers-faker/releases/latest).

#### Option A: SideStore (recommended, refreshes on the phone itself)

One-time setup (full guide: [docs.sidestore.io](https://docs.sidestore.io/docs/installation/prerequisites)):

1. On the iPhone, install **LocalDevVPN** from the App Store, open it and tap **Connect**.
2. On a computer (Windows, Mac or Linux), install **[iloader](https://iloader.app)**
   (Windows also needs iTunes).
3. Plug in the iPhone, tap **Trust** on the phone if asked.
4. In iloader: sign in with your Apple Account, pick your iPhone, click
   **Install SideStore (Stable)**.
5. On the iPhone: **Settings → General → VPN & Device Management** → your Apple Account →
   **Trust**.
6. **Settings → Privacy & Security → Developer Mode** → on (the phone restarts).
7. Open LocalDevVPN → **Connect**, then open **SideStore** and sign in with the same Apple
   Account.

Install Stompers Faker:

1. Download the `.ipa` from Releases on the iPhone (it lands in the Files app).
2. Make sure LocalDevVPN is connected.
3. In SideStore → **My Apps** → **+** → pick the `.ipa`.
4. Open Stompers Faker → **Grant** → allow reading and writing Steps.

Every few days: connect LocalDevVPN, open SideStore → My Apps → tap the **days left** button
next to each app to refresh it.

#### Option B: AltStore (needs your computer for every refresh)

One-time setup (full guide: [faq.altstore.io](https://faq.altstore.io)):

1. On the computer, install **AltServer** ([Mac](https://faq.altstore.io/altstore-classic/how-to-install-altstore-macos)
   or [Windows](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows);
   on Windows also iTunes and iCloud **from Apple's website**, not the Microsoft Store).
2. Plug in the iPhone, trust the computer, and turn on **Wi-Fi sync** for it
   (Finder on Mac, iTunes on Windows).
3. AltServer icon (menu bar / taskbar) → **Install AltStore** → your iPhone → sign in with
   your Apple Account.
4. On the iPhone: trust your Apple Account under **Settings → General → VPN & Device
   Management**, and turn on **Developer Mode** (Settings → Privacy & Security).

Install Stompers Faker: download the `.ipa` on the iPhone, then AltStore → **My Apps** →
**+** → pick the `.ipa`.

Refreshing only works while AltServer is running on your computer **on the same Wi-Fi**, so
open it at least once a week.

#### Updating on iPhone

Download the newer `.ipa` from Releases and install it the same way (My Apps → **+**). It
replaces the old version and keeps your data.

## How to use it

**Home**
- **Inject steps:** pick how many steps and a time window (e.g. `Today 13:30` to
  `Today 14:30`), then tap Inject. Presets **+1k · 10 min** and **+5k · 1 hr** do it in one
  tap.
- **Spread across today:** splits a number of steps into realistic 10–30 minute walks
  through the day. You see every walk before anything is added.
- If your new steps overlap ones you added earlier, you can **auto-shift** them to a free
  time, add them anyway, or cancel.
- Keep it believable: above ~200 steps per minute you get a warning.

**Records**: today's steps by hour (real in orange, fake in your accent color; tap a bar
for numbers), the list of steps you added today, and clean-up buttons.

**Snapshots**: save the current state ("Before the joke") and go back to it later.

**History**: everything you did, with who and when. **Undo** reverses any action. Old
entries can be cleared with **Delete old…**.

**Settings**: your name (shown in History), light/dark mode, accent color, updates.

Anything that changes several entries at once shows you exactly what will be added or
removed first, and saves an automatic snapshot, so it can be undone.

## Ending the joke

- **Records → Delete all fake records** removes everything the app added. Your real steps
  stay exactly as they were.
- Or **Snapshots → Restore** a snapshot you took before you started.

Removing the app does **not** remove the steps it added. Clean up first if you want them
gone.

## Good to know

- On Android 12/13 the app can only see the last ~30 days, so clean-ups reach that far.
- Stompers (or any app) may count steps from one source only when several overlap.
  That's decided by Health Connect / Apple Health, not by this app.
- On Huawei phones, opening the app from the home screen shows the logo on start; that's
  normal.

## For developers

- [docs/app.md](docs/app.md): shared React Native architecture, build commands, releases
- [docs/android.md](docs/android.md): Health Connect module, signing, CI, troubleshooting
- [docs/ios.md](docs/ios.md): HealthKit module, IPA build, sideloading options

---

> Made with [Claude Code](https://claude.com/claude-code)

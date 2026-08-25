# Ludo X  — Premium Ludo PWA

A complete, competition-level Ludo game delivered as a web app. Built from
scratch: no frameworks, no CDNs, no external fonts, no backend. Everything —
engine, AI, rendering, audio synthesis, progression — is hand-written in
~4,600 lines of dependency-free JavaScript.

**Play it:** serve this folder over HTTP (see *Run locally*), or open
`ludora.html` — a fully self-contained single-file build that runs offline
from a double-click.

---

## What's inside

| Area | Details |
|---|---|
| **Rules engine** (`js/engine.js`) | Authentic Ludo: 52-cell ring, exact home entry, six-release, captures (full stacks), safe starts + stars, extra turns (six / capture / home), three-six forfeit, 2–4 players, ranking by progress, daily variants (head start, race-to-capture). Pure & stateless between calls — fully unit-tested. |
| **AI** (`js/ai.js`) | Three genuinely different levels. Positional evaluation: capture value weighted by victim progress, home entry, lane entry, escape/enter threat modelling (exact 1/6 dice probability per chaser), safe-cell preference, endgame weighting. Easy adds heavy skewed noise; Hard is near-deterministic. **The AI never touches dice** — every roll comes from `crypto.getRandomValues` with rejection sampling, shared by humans and AI. |
| **Renderer** (`js/board.js`) | Single-canvas board: pre-rendered static layer + dynamic layer (tokens, halos, particles). Dimensional pawns with gradients, gloss, shadows; four token shapes; six board themes; stacking with count badges; capture bursts; home ripples. DPR-aware, 60 fps. |
| **Controller** (`js/game.js`) | ROLL → MOVE → RESULT → NEXT with no dead air: fast dice (~430 ms), hop animation per cell, single-legal-move auto-execution, natural AI think time, safe pause/resume, autosave after every stable point. |
| **UI** (`js/ui.js`, `index.html`, `css/app.css`) | iOS-inspired dark glass design system, system font stack, spring transitions, safe-area handling, portrait + landscape layouts, touch-first with keyboard support (Space = roll, 1–4 = tokens, Esc = pause). |
| **Progression** (`js/profile.js`) | Local profile, XP/levels, real stats (wins, captures, sixes, streaks), 16 achievements, match history, unlockable boards/dice/token cosmetics, deterministic daily challenges with streaks. All persisted in `localStorage` with validation. |
| **Audio** (`js/audio.js`) | Zero-asset WebAudio synth (dice, hops, captures, home, win fanfare) + haptics via `navigator.vibrate`. |
| **Navigation** (`js/ui.js` · `Nav`) | History-integrated router: every screen push syncs with browser history, so the Android/hardware back button navigates inside the app — exiting a running match auto-saves it first. Back dismisses open overlays (pause sheet) instead of leaving the match, edge-swipe back and Escape work on secondary screens, terminal flows (rematch, save & exit) collapse the stack, and a reload restores the screen you were on. |
| **Online multiplayer** (`js/net.js`, `js/mp.js`, `js/qr.js`) | Serverless peer-to-peer play over WebRTC DataChannels. The host owns the authoritative state (validated by the same engine as offline play); guests render signed-off snapshots with sequence numbers. Connection setup is human-carried — invite/reply codes via copy, native share, or QR (in-house encoder, no CDN). No accounts, no login, no database, no game server. A public STUN server is used **only** for NAT discovery during connection setup and never sees game data; gameplay and state are exclusively peer-to-peer. |
| **Hardened persistence** (`js/persist.js`) | Versioned envelopes with checksums, last-good-backup rotation, torn-write recovery, schema migrations (v1→v2 profiles load losslessly), IndexedDB primary + localStorage mirror, memory fallback, strict export/import. Stored data is corruption-resilient, not tamper-proof — that is inherent to offline-first apps. |
| **PWA** (`sw.js`, `manifest.webmanifest`, `icons/`) | Precached app shell, cache-first with background refresh, safe `SKIP_WAITING` update flow, maskable icons, standalone display, install prompt handling (incl. iOS guidance). Works fully offline after first load. |

## Run locally

```bash
node server.mjs          # → http://localhost:8000
```

Or any static host: `python3 -m http.server`, `npx serve`, etc.
For the full PWA experience (service worker, install) use `localhost` or HTTPS.

## Deploy (free, HTTPS, no domain purchase needed)

- **GitHub Pages** — push this folder to a repo, enable Pages. HTTPS by default.
- **Netlify Drop** — drag the folder onto <https://app.netlify.com/drop>.
- **Vercel / Cloudflare Pages** — import the folder as a static project.

No build step. No environment variables. No backend.

## Tests — 112 automated checks, all green

```bash
node dev/tests.cjs          # 52 unit tests: every rule + edge cases, 144 AI-vs-AI
                            # full games (2/3/4 players, all difficulties),
                            # online-mode engine, profile v2/online stats
node dev/persist-tests.cjs  # 16 persistence tests: checksums, torn writes, backup
                            # recovery, migrations, legacy v1 profiles, export/import
node dev/qr-tests.cjs       # 6 QR tests incl. the published (EC-L, mask 0) vector
node dev/mp-tests.cjs       # 21 multiplayer tests: full 2/3/4-player online games
                            # through the REAL controllers over a virtual network —
                            # synchronized dice/states/wins, invalid+out-of-turn+
                            # duplicate moves rejected, stale snapshots ignored,
                            # malformed/flooded peers kicked, disconnect/reconnect,
                            # AI takeover, host leave, early end, code round-trips
node dev/integration.cjs    # 17 integration tests in jsdom: complete matches via
                            # the real UI, save/resume, corruption recovery, nav
                            # router (back/popstate/edge-swipe), multiplayer screens,
                            # a11y live region
```

Requires `npm i jsdom` for the integration suite.

## Serverless multiplayer — how to play

1. **Host**: Multiplayer → Create Room → pick room size → share the Room ID for humans.
2. For each empty seat: *Create invite* → send the invite code (copy / share / QR).
3. **Guest**: Multiplayer → paste invite → Connect → send the reply code back to the host.
4. Host pastes the reply under that seat → the link opens. Everyone readies up, host starts.
5. QR codes encode a `#j=` deep link — scan with the native camera to prefill the invite.

Honest limitations: the host is a single point of failure (host leaves → room closes), guest reconnection requires a fresh seat invite, and the manual offer/answer exchange is the price of running without any server.

## Rules implemented

- Roll a **six** to release a token from the yard; a six always grants another roll.
- **Three consecutive sixes** burn the turn (classic rule).
- Landing on opponents **captures the whole stack** — unless the cell is safe.
- **Safe cells**: the four colored start cells + four star cells protect everyone.
- **Extra roll** for a six, a capture, or landing a token home.
- Home lane requires an **exact roll** to enter the center.
- First player with **all four tokens home** wins; others ranked by distance traveled.
- Dice are cryptographically random for every seat. Nothing is scripted.

## Project layout

```
index.html            app shell + SVG icon sprite
manifest.webmanifest  PWA manifest
sw.js                 service worker (versioned precache)
css/app.css           design system
js/                   engine, ai, store, profile, audio, board, game, ui, main
icons/                SVG + generated PNG icons (maskable + apple-touch)
dev/                  test suites, board design preview, single-file builder
ludora.html           self-contained single-file build (generated)
server.mjs            dev/static server with PWA headers
```

## Version

1.0.0 · cache version lives in `sw.js` (`VERSION`) — bump it when you change assets.

# Ship a polished casual mini-game

## Goal
Make Lone Wolf Arena feel like a finished, mobile-friendly browser mini-game by fixing the biggest blocker — performance — and adding the casual-player polish that keeps sessions short and satisfying.

## What we'll do

### 1. Performance audit & quick wins
- Measure current FPS on a low-power target (simulated via Playwright/Chrome throttling or build analysis).
- Reduce Three.js overhead:
  - Cap pixel ratio (`renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`).
  - Enable frustum culling, reduce shadow map size, and disable shadows on low-quality settings.
  - Merge/batch static arena geometry where possible; move decorative meshes to lower-poly LOD or omit on mobile.
  - Limit active particles, muzzle flashes, and tracer count.
- Add a "Quality" preset (Low / Medium / High) persisted in settings, defaulting to Low on mobile.
- Defer heavy init (audio, leaderboard fetch) until after first interaction.

### 2. Mobile/casual UX
- Improve touch controls: larger fire/move zones, clearer visual feedback, optional auto-fire for casual players.
- Add a "Resume / Quit" pause menu that works with touch.
- Shorten default match length or expose a "Quick Match" mode (first to 5 kills, 1 round).
- Add a clear "Start Match" button in warmup so players don't wait through the full countdown.
- Ensure onboarding tips are dismissible in one tap and don't block the game.

### 3. Visual & audio polish
- Add a clean main menu overlay with Play, Settings, and Leaderboard buttons.
- Show damage numbers and hit feedback more prominently.
- Add a round-end / match-end summary card with stats and a "Play Again" CTA.
- Tighten HUD spacing for small screens; keep essential info (HP, ammo, score) in thumb-safe zones.
- Ensure SFX volume ducking and mute state are obvious.

### 4. Stability & ship prep
- Fix any console errors or hydration warnings.
- Add a simple loading progress indicator instead of "Loading map…" text.
- Verify the leaderboard still writes/reads correctly after changes.
- Run a production build check and a mobile viewport smoke test.

## Out of scope (for this plan)
- Real-time multiplayer
- New maps or weapons
- Auth/accounts

## Success criteria
- Stable 30+ FPS on a simulated low-end mobile device during a full match.
- Touch controls feel responsive and intentional.
- A first-time player can start, play a short match, and restart without confusion.
- Build passes with no new errors.

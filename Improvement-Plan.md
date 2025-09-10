# SteamLauncher – Improvement Plan

This document tracks open improvement items and recommendations. Items are grouped by priority. Use the checkboxes to mark progress.

## Must-do before public release
- [x] Replace `eval('require')` with `createRequire` in:
  - `src/main.ts`
  - `src/classes.ts`
- [x] Tighten CSP for production renderer windows (dev may stay relaxed for HMR):
  - `src/windows/settings/index.html`
  - `src/windows/configure/index.html`
  - Remove `'unsafe-eval'`, `localhost`, and `ws` allowances in production.
- [ ] Ensure no secrets are logged anywhere
  - Already masked in `src/classes.ts` when launching; re-check other logs.
- [ ] Verify native module packaging for `keytar`
  - Confirm `keytar.node` present under `resources/app.asar.unpacked/...`
  - If `extraResource: 'node_modules/keytar'` is redundant, remove to slim package

## Product features
- [x] Start Steam only (omit `-applaunch`)
  - UI action in `src/App.vue`
  - Code path in `SteamStarter.execute()` to launch `steam` without args
- [ ] Busy indicator while launching and process watch
  - Show "Launching…" in `src/App.vue`
  - Toggle via IPC when `spawn()` starts and when game process detected
  - Optional timeout + failure toast

## Quality-of-life
- [x] Configure window UX
  - Add Show/Hide toggle on password field in `src/windows/configure/App.vue`
  - Validate username before saving; inline error if missing
- [ ] Settings window enhancements
  - [x] Hidden games list with Unhide
  - [ ] Optional: allow toggling hidden/visible for all games here
  - [ ] Add "Rescan games" button to trigger refresh

## Stability and polish
- [-] Handle username changes with stored passwords
  - Offer to migrate `keytar` credential from old user to new user for the same `steamID`
  - not required as the steam use for a given game will not change
- [ ] Reduce dev console noise
  - Switching to `createRequire` will remove dynamic require warnings
  - Ignore benign DevTools Autofill warnings
- [ ] Consistent styling
  - Move inline styles into shared CSS (e.g., `src/index.css`); share theme tokens across windows

## Developer ergonomics
- [ ] tsconfig tuning
  - Set `moduleResolution` to `bundler` (or `node16`) to quiet `@vitejs/plugin-vue` type warnings
- [ ] CI and docs
  - README section on dev vs prod window loading and keytar packaging
  - Optional GitHub Actions for lint and Linux packaging

## Packaging and distribution
- [ ] Makers metadata
  - Set icons, description, category in `@electron-forge/maker-deb` / `maker-rpm`
- [ ] Window icons
  - Provide `icon` in `BrowserWindow` options for Settings/Configure

## Completed
- [x] Migrate Settings/Configure to Vue Vite renderer windows
- [x] Remove legacy root `settings.html` / `configure.html`
- [x] Fix dev loading via Forge Vite injected constants in `src/main.ts`
- [x] Hidden games section with Unhide in Settings
- [x] Remove white margin/border and persistent scrollbars in sub-windows

## Next actions (suggested sequence)
1. Replace `eval('require')` with `createRequire` in main/classes
2. Tighten production CSP for settings/configure windows
3. Implement "Start Steam only" + Busy indicator
4. Add Configure show/hide password toggle and validations
5. tsconfig tuning + docs/CI polish

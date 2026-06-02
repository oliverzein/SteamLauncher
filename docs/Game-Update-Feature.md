# Game Update Feature Status

This document notes the current state, progress, and planned next steps for the Game Update feature.

---

## 1. Progress & Current State (Phase 1 Completed)

The first phase of the Game Update feature is fully implemented and committed to the repository:

- **Data Model Rework**: The `Game` interface in `src/classes.ts` has been extended with `updateAvailable?: boolean` and `lastUpdateCheck?: number`.
- **Local Version Reading**: Implemented `getLocalBuildID` in `src/main.ts` which reads the `"buildid"` value from local `appmanifest_[steamID].acf` files on disk.
- **Remote Version Fetching**: Implemented `getRemoteBuildID` in `src/main.ts` which queries the public API `https://api.steamcmd.net/v1/info/[steamID]`, falling back to `steamcmd +login anonymous +app_info_update 1 +app_info_print [steamID] +quit` if the Web-API times out or fails.
- **Background Checks**: Wired up async background checks on app start and manual refresh. Checks are rate-limited to run once every 12 hours unless forced.
- **Vue UI Visual Indicator**: Standardized bottom-right action bar on game cards in `src/App.vue` to show a 48px upgrade icon button when `game.updateAvailable` is true.

---

## 2. Next Steps: Phase 2 – Download & Update Implementation

The objective of Phase 2 is to carry out the actual game download and update process using `steamcmd` without having to launch the full Steam GUI client.

### Planned Tasks

1. **Locate Game Install Folder**:
   - Parse `"installdir"` from the target game's `appmanifest_[steamID].acf` file.
   - Construct absolute path: `<steamappsDir>/common/<installdir>`.

2. **Invoke steamcmd Update Process**:
   - Retrieve stored account password securely using Keytar.
   - Spawn the update process asynchronously:
     ```bash
     steamcmd +force_install_dir "[gamePath]" +login [user] [password] +app_update [steamID] validate +quit
     ```

3. **Fortschritt (Progress) Parsing**:
   - Parse `stdout` from the spawned `steamcmd` process using regex:
     ```typescript
     const progressRegex = /progress:\s+([\d.]+)\s+\((\d+)\s+\/\s+(\d+)\)/;
     ```
   - Standardize progress events (percentage, bytes downloaded, total bytes, status like `downloading` or `validating`) and emit them via Electron IPC to the frontend.

4. **Steam Guard (2FA) & Interactive Login**:
   - Detect if `steamcmd` prompts for a Steam Guard code (2FA).
   - If prompted, pause the process and request/show a 2FA prompt in the Electron UI.
   - Feed user inputs back to the `stdin` of `steamcmd`.
   - *Note*: An successfully completed login caches the token locally, making subsequent updates unattended.

5. **Vue UI Integration**:
   - Bind click handler on `game-update-btn` to trigger the IPC update routine.
   - Replace or overlay action icons with a styled progress bar or update status indicator on the game card during active updates.
   - Re-run `checkGameUpdate` on completion to verify the update succeeded and clear the update visual badge.

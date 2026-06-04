# Game Update Feature Status

This document notes the current state, progress, and planned next steps for the Game Update feature.

---

## 1. Progress & Current State (Phase 1 & Phase 2 Completed)

All phases of the Game Update feature are fully implemented and committed to the repository:

- **Data Model Rework**: The `Game` interface in `src/classes.ts` has been extended with `updateAvailable?: boolean` and `lastUpdateCheck?: number`.
- **Local Version Reading**: Implemented `getLocalBuildID` in `src/main.ts` which reads the `"buildid"` value from local `appmanifest_[steamID].acf` files on disk.
- **Remote Version Fetching**: Implemented `getRemoteBuildID` in `src/main.ts` which queries the public API `https://api.steamcmd.net/v1/info/[steamID]`, falling back to `steamcmd +login anonymous +app_info_update 1 +app_info_print [steamID] +quit` if the Web-API times out or fails.
- **Background Checks**: Wired up async background checks on app start and manual refresh. Checks are rate-limited to run once every 12 hours unless forced.
- **Vue UI Visual Indicator**: Standardized bottom-right action bar on game cards in `src/App.vue` to show a 48px upgrade icon button when `game.updateAvailable` is true.
- **Interactive SteamCMD Update & 2FA**:
  - **Install Folder Locating**: Added logic to resolve game path from target game's ACF `installdir` value.
  - **Spawn steamcmd Update Process**: Retrieves stored credentials from Keytar and starts update command with validation.
  - **Progress Parsing**: Parses stdout stream to extract state (downloading, validating, preallocating) and percentage using regex, reporting via IPC events to UI.
  - **Steam Guard Prompt**: Detects interactive 2FA challenge, requests input via modal, feeds code to process stdin.
  - **UI Progress Overlay**: Overlays cards with blur-backdrop, progress bar, percentage, status text, and cancel controls.
  - **Verifying Update Success**: Automatically checks game update status again upon exit to confirm success.

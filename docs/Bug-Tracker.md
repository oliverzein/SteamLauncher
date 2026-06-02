# Bug Tracker

This document tracks known issues, system-specific quirks, and compatibility bugs in SteamLauncher.

---

## 1. Active & Known Issues

| ID | Issue Description | Severity | Status | Workaround / Mitigation |
| :--- | :--- | :--- | :--- | :--- |
| **BUG-001** | `steamcmd` is not found in system `PATH` on certain systems (e.g., when installed outside `/usr/bin`). | Medium | **Tracked** | Add a configuration option to set custom `steamcmd` path, or search default Steam directories. |
| **BUG-002** | SteamCMD update login terminates active grafische Steam UI session (Session Kick) when logging in with same account. | High | **Tracked** | Inform the user to close their official Steam client before triggering updates. |
| **BUG-003** | Web-API `api.steamcmd.net` can hit rate limits or block IP addresses if manual refresh is triggered excessively. | Low | **Mitigated** | Implemented 12-hour ratelimit on automatic checks. Manual checks ignore ratelimit but should be used sparingly. |
| **BUG-004** | Node 26+ compatibility issue: Silent Hang/Exit during packaging using `@electron/packager` due to `extract-zip`/`yauzl` early exit. | High | **Mitigated** | Patched `@electron/packager` unzip logic (`node_modules/@electron/packager/dist/unzip.js`) to use fast native system `unzip` utility. |

---

## 2. Completed Bug Fixes

| ID | Issue Description | Resolution | Date |
| :--- | :--- | :--- | :--- |
| **FIX-001** | White margins/borders and persistent scrollbars rendered in Configure/Settings sub-windows. | Reset CSS default margins and applied modern scrollbar styling. | 2026-06-01 |
| **FIX-002** | AppImage build fails due to missing `mksquashfs` package dependency on CachyOS/Arch. | Documented the need to install `squashfs-tools` globally. | 2026-06-01 |
| **FIX-003** | Closing and reopening the App Window via the tray icon causes the app to hang in "Loading Steam Games...". | Moved the `did-finish-load` listener and the initial games loading IPC event into the `createWindow` function so it triggers for every newly created window instance. | 2026-06-02 |


# FUSE Suspend Deadlock Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the SteamLauncher AppImage FUSE suspend deadlock by validating the root cause (Phase 1) and permanently fixing it by switching to uruntime (Phase 2).

**Architecture:** Phase 1 validates that FUSE is the root cause by running SteamLauncher without FUSE (`APPIMAGE_EXTRACT_AND_RUN=1`). Phase 2 swaps the AppImage runtime from type2-runtime (known suspend deadlock bug, issue #119) to uruntime (confirmed fix for suspend) via a one-line config change in `forge.config.ts`.

**Tech Stack:** Electron 38.0.0, `@reforged/maker-appimage` 5.2.0, AppImage type2-runtime (current) → VHSgunzo/uruntime v0.5.8 (target), systemd, CachyOS kernel 7.0.11-1-cachyos.

**Context documents:**
- Root cause analysis: `knowledge-vault:SteamLauncher/steamlauncher-fuse-suspend-deadlock.md`
- Current workaround: `/usr/lib/systemd/system-sleep/10-steamlauncher.sh`
- Autostart entry: `~/.config/autostart/Steam Launcher.desktop`

---

## Phase 1: Validation (Option D — APPIMAGE_EXTRACT_AND_RUN)

**Purpose:** Confirm FUSE is the root cause by running SteamLauncher without FUSE mount. If suspend succeeds after long uptime with extract-and-run, FUSE is confirmed and we proceed to Phase 2.

### Task 1: Back up current autostart entry

**Files:**
- Read: `~/.config/autostart/Steam Launcher.desktop`
- Create: `~/.config/autostart/Steam Launcher.desktop.bak`

- [ ] **Step 1: Back up the autostart desktop entry**

```bash
cp "$HOME/.config/autostart/Steam Launcher.desktop" "$HOME/.config/autostart/Steam Launcher.desktop.bak"
```

- [ ] **Step 2: Verify backup exists**

Run: `ls -la "$HOME/.config/autostart/Steam Launcher.desktop.bak"`
Expected: File exists with same size as original.

### Task 2: Add APPIMAGE_EXTRACT_AND_RUN=1 to autostart entry

**Files:**
- Modify: `~/.config/autostart/Steam Launcher.desktop`

The current `Exec` line is:
```
Exec=/home/oliverzein/.local/bin/steamlauncher
```

We need to set the `APPIMAGE_EXTRACT_AND_RUN=1` environment variable for the launched process. Desktop entry spec supports env vars via a wrapper shell.

- [ ] **Step 1: Update the Exec line to use env var**

Replace the `Exec` line in `~/.config/autostart/Steam Launcher.desktop`:

Old:
```
Exec=/home/oliverzein/.local/bin/steamlauncher
```

New:
```
Exec=env APPIMAGE_EXTRACT_AND_RUN=1 /home/oliverzein/.local/bin/steamlauncher
```

- [ ] **Step 2: Verify the change**

Run: `grep "^Exec=" "$HOME/.config/autostart/Steam Launcher.desktop"`
Expected: `Exec=env APPIMAGE_EXTRACT_AND_RUN=1 /home/oliverzein/.local/bin/steamlauncher`

### Task 3: Restart SteamLauncher with extract-and-run mode

- [ ] **Step 1: Stop the currently running SteamLauncher**

```bash
systemctl --user stop "app-Steam\x20Launcher@autostart.service"
```

If that fails (unit may already be inactive), kill directly:
```bash
pgrep -x steamlauncher && kill -TERM $(pgrep -x steamlauncher)
```

- [ ] **Step 2: Verify no steamlauncher process running**

Run: `pgrep -x steamlauncher`
Expected: No output (no process found).

- [ ] **Step 3: Start SteamLauncher with extract-and-run via autostart unit**

```bash
systemctl --user daemon-reload
systemctl --user start "app-Steam\x20Launcher@autostart.service"
```

- [ ] **Step 4: Verify SteamLauncher is running WITHOUT FUSE mount**

Run: `pgrep -x steamlauncher`
Expected: PID output (process running).

Run: `mount | grep steamlauncher`
Expected: **No output** — no FUSE mount present (extract-and-run mode doesn't mount).

Run: `ls /tmp/.mount_steaml* 2>/dev/null`
Expected: No output (no FUSE mount directory).

If a FUSE mount IS present, the env var didn't take effect. Check the unit definition:
```bash
systemctl --user cat "app-Steam\x20Launcher@autostart.service"
```
Verify `ExecStart=` contains `env APPIMAGE_EXTRACT_AND_RUN=1`.

### Task 4: Verify SteamLauncher functionality (extract-and-run mode)

Confirm the app works correctly without FUSE before testing suspend.

- [ ] **Step 1: Verify tray icon appears**

Check system tray for SteamLauncher icon. If not visible, check logs:
```bash
journalctl --user -u "app-Steam\x20Launcher@autostart.service" --since "5 min ago" --no-pager
```
Expected: No errors, app started successfully.

- [ ] **Step 2: Verify window opens**

Click tray icon or:
```bash
# Send signal to show window - check if app responds
pgrep -x steamlauncher
```
Expected: Process alive, window visible when clicking tray.

- [ ] **Step 3: Verify game list loaded**

Open SteamLauncher window. Expected: Game cards visible (games loaded from config).

- [ ] **Step 4: Verify keytar works (password storage)**

Open a game's configure window, check if stored password is retrieved. If keytar fails, the native addon may not load from extracted dir. Check logs for keytar errors.

If keytar fails: this is a known risk with extract-and-run (different file layout). Note the error — Phase 2 (uruntime) should handle this better since it still uses FUSE mount.

### Task 5: Test suspend with extract-and-run (accelerated)

Use `drop_caches` to simulate long-running page eviction without waiting days.

- [ ] **Step 1: Temporarily disable the systemd suspend hook**

The suspend hook kills SteamLauncher before suspend, which would mask the test result. Disable it temporarily:

```bash
sudo chmod -x /usr/lib/systemd/system-sleep/10-steamlauncher.sh
```

- [ ] **Step 2: Verify hook is disabled**

Run: `ls -la /usr/lib/systemd/system-sleep/10-steamlauncher.sh`
Expected: Permissions show `-rw-r--r--` (no execute bit).

- [ ] **Step 3: Evict page cache to simulate long-running state**

```bash
sync
sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'
```

- [ ] **Step 4: Verify cache dropped**

Run: `free -h`
Expected: `buff/cache` significantly reduced (close to 0).

- [ ] **Step 5: Suspend the system**

```bash
systemctl suspend
```

Or trigger suspend via desktop environment (KDE menu → Sleep).

- [ ] **Step 6: After resume, check kernel logs for freeze failures**

```bash
journalctl -k --since "10 min ago" --no-pager | grep -E "refusing to freeze|Freezing user space|freeze"
```

**Expected outcome (FUSE confirmed):** No "refusing to freeze" error. Suspend succeeded without deadlock. This confirms FUSE was the root cause — without FUSE (extract-and-run), no deadlock occurs.

**Alternative outcome (FUSE not confirmed):** If "refusing to freeze" still appears with SteamLauncher/Chrome_ChildIOT as the refusing task, FUSE is not the sole cause. Investigate other file-backed mappings (crashpad, GPU cache, etc.).

- [ ] **Step 7: Verify SteamLauncher survived resume**

Run: `pgrep -x steamlauncher`
Expected: PID output (process still alive after resume).

If process died, check logs:
```bash
journalctl --user -u "app-Steam\x20Launcher@autostart.service" --since "10 min ago" --no-pager
```

### Task 6: Re-enable suspend hook and revert validation changes

- [ ] **Step 1: Re-enable the systemd suspend hook**

```bash
sudo chmod +x /usr/lib/systemd/system-sleep/10-steamlauncher.sh
```

- [ ] **Step 2: Verify hook is re-enabled**

Run: `ls -la /usr/lib/systemd/system-sleep/10-steamlauncher.sh`
Expected: Permissions show `-rwxr-xr-x` (execute bit set).

- [ ] **Step 3: Revert autostart entry to original**

```bash
cp "$HOME/.config/autostart/Steam Launcher.desktop.bak" "$HOME/.config/autostart/Steam Launcher.desktop"
```

- [ ] **Step 4: Verify revert**

Run: `grep "^Exec=" "$HOME/.config/autostart/Steam Launcher.desktop"`
Expected: `Exec=/home/oliverzein/.local/bin/steamlauncher` (original, no env var).

- [ ] **Step 5: Restart SteamLauncher in normal (FUSE) mode**

```bash
systemctl --user daemon-reload
systemctl --user stop "app-Steam\x20Launcher@autostart.service" 2>/dev/null || true
pgrep -x steamlauncher && kill -TERM $(pgrep -x steamlauncher) 2>/dev/null || true
sleep 2
systemctl --user start "app-Steam\x20Launcher@autostart.service"
```

- [ ] **Step 6: Verify FUSE mount is back**

Run: `mount | grep steamlauncher`
Expected: `steamlauncher on /tmp/.mount_steamlXXXXXX type fuse.steamlauncher (ro,nosuid,nodev,relatime,user_id=1000,group_id=1000)`

### Task 7: Document validation results

- [ ] **Step 1: Record validation outcome in knowledge-vault**

Append results to `SteamLauncher/steamlauncher-fuse-suspend-deadlock.md` under a new "## Validation Results" section:

```
## Validation Results (Phase 1)

**Date:** 2026-06-22
**Method:** APPIMAGE_EXTRACT_AND_RUN=1 + drop_caches + suspend
**Result:** [PASS/FAIL — fill in after test]
**Kernel log:** [paste relevant journalctl -k output]
**Conclusion:** FUSE [confirmed/refuted] as root cause.
```

**Decision gate:** If validation PASSED (suspend succeeded without FUSE), proceed to Phase 2. If FAILED, do not proceed — investigate other causes first.

---

## Phase 2: Permanent Fix (Option E — uruntime)

**Purpose:** Replace type2-runtime with uruntime in the AppImage build. uruntime is confirmed by the AppImage community to eliminate the suspend deadlock.

### Task 8: Update forge.config.ts to use uruntime

**Files:**
- Modify: `forge.config.ts:32-37`

Current `MakerAppImage` config:
```typescript
new MakerAppImage({
  options: {
    icon: 'assets/app-icon.png',
    categories: ['Game', 'Utility'],
  }
}),
```

- [ ] **Step 1: Add uruntime runtime URL to MakerAppImage options**

Replace the `MakerAppImage` block in `forge.config.ts`:

Old:
```typescript
new MakerAppImage({
  options: {
    icon: 'assets/app-icon.png',
    categories: ['Game', 'Utility'],
  }
}),
```

New:
```typescript
new MakerAppImage({
  options: {
    icon: 'assets/app-icon.png',
    categories: ['Game', 'Utility'],
    // Use uruntime instead of type2-runtime to fix FUSE suspend deadlock.
    // type2-runtime has a known kernel freezer deadlock on suspend (issue #119).
    // uruntime handles FUSE lifecycle differently (idle unmount, extract-and-run fallback).
    // See: knowledge-vault:SteamLauncher/steamlauncher-fuse-suspend-deadlock.md
    runtime: 'https://github.com/VHSgunzo/uruntime/releases/download/v0.5.8/uruntime-appimage-squashfs-x86_64',
  }
}),
```

- [ ] **Step 2: Verify the change**

Run: `grep -A5 'MakerAppImage' forge.config.ts`
Expected: Output shows the `runtime` option with uruntime URL.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit forge.config.ts 2>&1 | head -20`
Expected: No type errors (the `runtime` option is typed as `string` in `MakerAppImageConfigOptions`).

If type errors appear, check that `@reforged/maker-appimage` types include `runtime`:
```bash
grep -r 'runtime' node_modules/@reforged/maker-appimage/types/
```

### Task 9: Build new AppImage with uruntime

- [ ] **Step 1: Build the AppImage**

```bash
cd /home/oliverzein/Dokumente/Daten/Development/Electron/SteamLauncher
npm run make -- --targets=AppImage
```

Expected: Build completes, artifact at `out/make/AppImage/x64/steamlauncher-1.6.2-x64.AppImage`.

If build fails on runtime download, check network access to GitHub releases. The maker will `fetch()` the uruntime binary from the URL.

- [ ] **Step 2: Verify the built AppImage uses uruntime**

```bash
./out/make/AppImage/x64/steamlauncher-1.6.2-x64.AppImage --appimage-version
```

Expected: Output mentions `uruntime` or `VHSgunzo/uruntime` (NOT `type2-runtime`).

If it still shows type2-runtime, the `runtime` option wasn't picked up. Check forge.config.ts syntax and maker-appimage version (must be ≥5.1.0 for `runtime` option support).

- [ ] **Step 3: Verify AppImage offset and structure**

```bash
./out/make/AppImage/x64/steamlauncher-1.6.2-x64.AppImage --appimage-offset
```

Expected: A numeric byte offset (e.g., `944632` or different — uruntime may have different header size).

### Task 10: Install the uruntime-based AppImage

- [ ] **Step 1: Stop running SteamLauncher**

```bash
systemctl --user stop "app-Steam\x20Launcher@autostart.service" 2>/dev/null || true
pgrep -x steamlauncher && kill -TERM $(pgrep -x steamlauncher) 2>/dev/null || true
sleep 2
pgrep -x steamlauncher && kill -KILL $(pgrep -x steamlauncher) 2>/dev/null || true
```

- [ ] **Step 2: Verify no steamlauncher running**

Run: `pgrep -x steamlauncher`
Expected: No output.

- [ ] **Step 3: Verify no orphaned FUSE mounts**

Run: `mount | grep steamlauncher`
Expected: No output. If mounts remain, unmount: `fusermount -u /tmp/.mount_steaml* 2>/dev/null || sudo umount /tmp/.mount_steaml*`

- [ ] **Step 4: Install new AppImage to ~/.local/bin**

```bash
cp ./out/make/AppImage/x64/steamlauncher-1.6.2-x64.AppImage ~/.local/bin/steamlauncher
chmod +x ~/.local/bin/steamlauncher
```

- [ ] **Step 5: Verify installation**

Run: `~/.local/bin/steamlauncher --appimage-version`
Expected: uruntime version output.

### Task 11: Test SteamLauncher functionality with uruntime

Verify all features work with the new runtime before testing suspend.

- [ ] **Step 1: Start SteamLauncher**

```bash
systemctl --user start "app-Steam\x20Launcher@autostart.service"
```

- [ ] **Step 2: Verify process is running**

Run: `pgrep -x steamlauncher`
Expected: PID output.

- [ ] **Step 3: Verify FUSE mount is present (uruntime uses FUSE by default)**

Run: `mount | grep steamlauncher`
Expected: FUSE mount present. Note: mount type may differ from type2-runtime (uruntime may show as `fuse` or `fuse.steamlauncher`).

- [ ] **Step 4: Verify tray icon appears**

Check KDE system tray for SteamLauncher icon.

- [ ] **Step 5: Verify window opens and game list loads**

Click tray icon → window opens → game cards visible.

- [ ] **Step 6: Verify keytar (password storage) works**

Open a game's configure window. Verify stored password is retrieved (if previously set). Check logs for keytar errors:
```bash
journalctl --user -u "app-Steam\x20Launcher@autostart.service" --since "5 min ago" --no-pager | grep -i keytar
```
Expected: No keytar errors.

If keytar fails: the native addon path resolution may differ with uruntime. Check `process.resourcesPath` and asar unpacking. May need to adjust `packagerConfig.asar.unpackDir` or `extraResource` paths.

- [ ] **Step 7: Verify global shortcuts work**

Press `Ctrl+Shift+I` or `F12` in the SteamLauncher window → DevTools should open (in dev mode) or do nothing (in production, but no crash).

- [ ] **Step 8: Verify game launch works**

Click a game card to launch a game. Verify the launching indicator appears and the game starts.

- [ ] **Step 9: Verify settings window works**

Open settings → verify window opens and config is displayed.

### Task 12: Test suspend with uruntime (accelerated)

This is the critical test — verify the deadlock is eliminated.

- [ ] **Step 1: Disable the systemd suspend hook (safety net removed)**

```bash
sudo chmod -x /usr/lib/systemd/system-sleep/10-steamlauncher.sh
```

- [ ] **Step 2: Verify hook is disabled**

Run: `ls -la /usr/lib/systemd/system-sleep/10-steamlauncher.sh`
Expected: `-rw-r--r--` (no execute bit).

- [ ] **Step 3: Evict page cache to simulate long-running state**

```bash
sync
sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'
```

- [ ] **Step 4: Verify cache dropped**

Run: `free -h`
Expected: `buff/cache` near zero.

- [ ] **Step 5: Suspend the system**

```bash
systemctl suspend
```

- [ ] **Step 6: After resume, check kernel logs**

```bash
journalctl -k --since "10 min ago" --no-pager | grep -E "refusing to freeze|Freezing user space|freeze"
```

**Expected outcome (FIX CONFIRMED):** No "refusing to freeze" error. Suspend succeeded. uruntime eliminated the deadlock.

**Alternative outcome (fix failed):** If "refusing to freeze" still appears, uruntime did not solve the issue for this specific case. Re-enable the suspend hook and fall back to Option A (powerMonitor + app.quit).

- [ ] **Step 7: Verify SteamLauncher survived resume**

Run: `pgrep -x steamlauncher`
Expected: PID output (process alive).

If process died during suspend/resume, check logs:
```bash
journalctl --user -u "app-Steam\x20Launcher@autostart.service" --since "10 min ago" --no-pager
```

### Task 13: Re-enable suspend hook or remove it

**Decision gate:** Based on Task 12 results.

**If suspend test PASSED (no deadlock):**

- [ ] **Step 1a: Remove the suspend hook entirely**

```bash
sudo rm /usr/lib/systemd/system-sleep/10-steamlauncher.sh
```

- [ ] **Step 2a: Verify hook is removed**

Run: `ls /usr/lib/systemd/system-sleep/10-steamlauncher.sh 2>/dev/null`
Expected: No output (file gone).

**If suspend test FAILED (deadlock persists):**

- [ ] **Step 1b: Re-enable the suspend hook**

```bash
sudo chmod +x /usr/lib/systemd/system-sleep/10-steamlauncher.sh
```

- [ ] **Step 2b: Revert forge.config.ts to type2-runtime**

Remove the `runtime` option from `MakerAppImage` config (revert Task 8 changes).

- [ ] **Step 3b: Fall back to Option A (powerMonitor + app.quit)**

Implement `powerMonitor.on('suspend', () => app.quit())` in `src/main.ts`. See knowledge doc for details. This is a separate plan.

### Task 14: Commit the permanent fix

Only if Task 12 passed and hook was removed.

- [ ] **Step 1: Review changes**

```bash
cd /home/oliverzein/Dokumente/Daten/Development/Electron/SteamLauncher
git diff forge.config.ts
```

Expected: Only the `runtime` option added to `MakerAppImage`.

- [ ] **Step 2: Stage and commit**

```bash
git add forge.config.ts
git commit -m "$(cat <<'EOF'
fix: switch AppImage runtime to uruntime to resolve FUSE suspend deadlock

type2-runtime has a known kernel freezer deadlock on system suspend
(AppImage/type2-runtime issue #119). When the kernel freezes userspace
for suspend, the FUSE daemon (the app itself) is frozen, but child
processes with file-backed mappings on the FUSE mount can be stuck in
page faults waiting for the frozen daemon — causing a 20s freeze
timeout and suspend failure.

uruntime (VHSgunzo/uruntime v0.5.8) handles FUSE lifecycle differently
(idle unmount timeouts, extract-and-run fallback, better signal handling)
and is confirmed by the AppImage community to eliminate the suspend
deadlock.

See knowledge-vault:SteamLauncher/steamlauncher-fuse-suspend-deadlock.md
for full root cause analysis.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

### Task 15: Update knowledge-vault with final results

- [ ] **Step 1: Update the knowledge doc status**

Patch `SteamLauncher/steamlauncher-fuse-suspend-deadlock.md`:

Update the header status from:
```
**Status:** Workaround deployed (suspend hook), underlying bug unfixed
```
To:
```
**Status:** Fixed (uruntime swap). Suspend hook removed.
```

- [ ] **Step 2: Append final results section**

Append to the doc:

```
## Fix Results (Phase 2)

**Date:** [fill in]
**Fix applied:** Switched AppImage runtime from type2-runtime to uruntime v0.5.8
**Config change:** `forge.config.ts` — added `runtime` option to `MakerAppImage`
**Suspend test:** [PASS/FAIL]
**Suspend hook:** [Removed/Re-enabled]
**Commit:** [commit hash]
```

- [ ] **Step 3: Verify knowledge doc updated**

Read back the doc to confirm status and results section are present.

---

## Rollback Plan

If anything goes wrong during Phase 2:

1. **Revert forge.config.ts:** `git checkout forge.config.ts`
2. **Rebuild with type2-runtime:** `npm run make -- --targets=AppImage`
3. **Reinstall old AppImage:** `cp out/make/AppImage/x64/steamlauncher-1.6.2-x64.AppImage ~/.local/bin/steamlauncher`
4. **Re-enable suspend hook:** `sudo chmod +x /usr/lib/systemd/system-sleep/10-steamlauncher.sh`
5. **Restart SteamLauncher:** `systemctl --user start "app-Steam\x20Launcher@autostart.service"`

The systemd suspend hook is the safety net throughout — it works regardless of which runtime is used.

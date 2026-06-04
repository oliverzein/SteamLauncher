# Implementation Plan: Main Process Decomposition

This plan outlines the systematic breakdown of the monolithic [main.ts](file:///home/oliverzein/Dokumente/Daten/Development/Electron/SteamLauncher/src/main.ts) file into clean, modular TypeScript service components and utility files.

## Approach
- **Why this solution**: Breaking down the 1,488-line file improves maintainability, unit testability, and conforms to the Single Responsibility Principle.
- **Alternatives considered**:
  - *Keep everything in main.ts*: High risk of regression during future updates; difficult to test.
  - *Keep states global in main.ts and export functions*: Still leaves `main.ts` cluttered with global state variables (`config`, `steamStarters`, `activeUpdates`).
  - *Recommended (OOP Service Pattern)*: Extract self-contained singleton services (`ConfigService`, `SteamService`, `UpdateService`) that manage their own state.

---

## Steps

### 1. File & Directory Setup (5 min)
Create the new folder structure for services and utilities:
```bash
mkdir -p src/services src/utils
touch src/utils/helpers.ts
touch src/services/config.service.ts
touch src/services/steam.service.ts
touch src/services/update.service.ts
```

### 2. Low-Level Utilities Extraction (15 min)
Extract stateless, environment-independent functions to [helpers.ts](file:///home/oliverzein/Dokumente/Daten/Development/Electron/SteamLauncher/src/utils/helpers.ts):
- Functions: `waitForDevServer`, `run`, `buildPgrepCmd`, `resolveAsset`, `getAppIconPath`
- Exports from [helpers.ts](file:///home/oliverzein/Dokumente/Daten/Development/Electron/SteamLauncher/src/utils/helpers.ts):
```typescript
import { app } from 'electron';
import { exec } from 'child_process';
import path from 'node:path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';

export function waitForDevServer(urlStr: string, ...): Promise<void> { ... }
export function run(cmd: string): Promise<{ code: number | null; stdout: string; stderr: string }> { ... }
export function buildPgrepCmd(raw: string): string { ... }
export function resolveAsset(...segments: string[]): string { ... }
export function getAppIconPath(): string | undefined { ... }
```

### 3. Configuration Service Implementation (20 min)
Create the `ConfigService` in [config.service.ts](file:///home/oliverzein/Dokumente/Daten/Development/Electron/SteamLauncher/src/services/config.service.ts) to manage the config state and file operations.
- State: `private config: Config`
- Methods:
```typescript
export class ConfigService {
  private config: Config = { compatdataPaths: [], steamApps: [] };

  public getConfig(): Config { return this.config; }
  public loadConfig(): void { ... }
  public saveConfig(newConfig?: Partial<Config>): void { ... }
  public getVisibleGamesSorted(): Game[] { ... }
  public compareByOrder(a: Game, b: Game): number { ... }
  public getNextOrderValue(): number { ... }
  public reindexGameOrders(): void { ... }
}
export const configService = new ConfigService();
```

### 4. Steam Service Implementation (20 min)
Create `SteamService` in [steam.service.ts](file:///home/oliverzein/Dokumente/Daten/Development/Electron/SteamLauncher/src/services/steam.service.ts) to orchestrate directory scanning, app details fetching, launch prep, and update check triggers.
- Depends on: `ConfigService`
- Methods:
```typescript
export class SteamService {
  public fetchGames(): Promise<Game[]> { ... }
  public getLocalBuildID(steamID: number): string | null { ... }
  public getRemoteBuildID(steamID: number): Promise<string | null> { ... }
  public checkGameUpdate(steamID: number, force?: boolean): Promise<boolean> { ... }
  public triggerBackgroundUpdateChecks(force?: boolean): Promise<void> { ... }
  public ensureSteamUserOrShutdown(desiredUser: string): Promise<void> { ... }
  public applyResolutionIfConfigured(index: number): Promise<void> { ... }
}
export const steamService = new SteamService();
```

### 5. Update Service Implementation (20 min)
Extract `UpdateService` in [update.service.ts](file:///home/oliverzein/Dokumente/Daten/Development/Electron/SteamLauncher/src/services/update.service.ts) to manage the dynamic `steamcmd` update sessions.
- State: `private activeUpdates: Map<number, UpdateSession>`
- Methods:
```typescript
export class UpdateService {
  private activeUpdates = new Map<number, UpdateSession>();

  public updateGame(steamID: number): Promise<{ success: boolean; error?: string }> { ... }
  public submitSteamGuard(steamID: number, code: string): Promise<{ success: boolean; error?: string }> { ... }
  public cancelUpdate(steamID: number): Promise<{ success: boolean; error?: string }> { ... }
}
export const updateService = new UpdateService();
```

### 6. App Integration and IPC Cleanup (30 min)
Simplify [main.ts](file:///home/oliverzein/Dokumente/Daten/Development/Electron/SteamLauncher/src/main.ts):
- Import singletons: `configService`, `steamService`, `updateService`.
- Keep window management (`createWindow`, lifecycle) and tray setup in `main.ts`.
- Bind IPC handlers by forwarding straight to the extracted services. Example:
```typescript
ipcMain.handle('start-game', async (event, index: number) => {
  // validation ...
  const starter = steamStarters[index];
  const game = configService.getConfig().steamApps[index];
  await steamService.ensureSteamUserOrShutdown(game.user);
  await steamService.applyResolutionIfConfigured(index);
  // launch & watch process ...
});
```

### 7. Build and Quality Verification (15 min)
Verify that TypeScript compiles, linters pass, and the packaging succeeds:
```bash
npm run lint
npm run package
```

---

## Timeline

| Phase | Duration |
|-------|----------|
| Step 1: File Setup | 5 min |
| Step 2: Helpers Extraction | 15 min |
| Step 3: Config Service | 20 min |
| Step 4: Steam Service | 20 min |
| Step 5: Update Service | 20 min |
| Step 6: App Integration | 30 min |
| Step 7: Verification | 15 min |
| **Total** | **2 hours 5 min** |

---

## Rollback Plan
1. **Revert Git Commits**:
   If compilation issues or bugs occur, discard local modifications and restore main:
   ```bash
   git checkout -- src/main.ts src/classes.ts
   rm -rf src/services src/utils
   ```
2. **Re-Verify Packaging**:
   Confirm that packaging still succeeds on the pristine branch.

---

## Security Checklist
- [ ] **Input Validation**: Retain IPC handler index, bounds, and string checks in all handlers.
- [ ] **Secure Storage**: Ensure the refactored keytar calls use [loadKeytar()](file:///home/oliverzein/Dokumente/Daten/Development/Electron/SteamLauncher/src/classes.ts#L5) and do not leak passwords in CLI arguments.
- [ ] **Sandboxing**: Maintain Electron BrowserWindow `sandbox: true` and `contextIsolation: true` in all BrowserWindow properties.

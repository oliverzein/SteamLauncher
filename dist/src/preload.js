"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // Start a Steam game
    startGame: (index) => electron_1.ipcRenderer.invoke('start-game', index),
    // Get current configuration
    getConfig: () => electron_1.ipcRenderer.invoke('get-config'),
    // Save configuration
    saveConfig: (config) => electron_1.ipcRenderer.invoke('save-config', config),
    // Open settings (placeholder for future implementation)
    openSettings: () => electron_1.ipcRenderer.invoke('open-settings'),
    // Start Steam client only (no -applaunch) for a given game index
    startSteamOnly: (index) => electron_1.ipcRenderer.invoke('start-steam-only', index),
    // Listen for games loaded event
    onGamesLoaded: (callback) => {
        electron_1.ipcRenderer.on('games-loaded', (event, games) => callback(games));
    },
    // Open configure window for a game
    openConfigure: (steamID) => electron_1.ipcRenderer.invoke('open-configure', steamID),
    // Save game configuration (optionally include processName, resolution, and notes)
    saveGameConfig: (index, user, password, processName, resolution, notes) => electron_1.ipcRenderer.invoke('save-game-config', index, user, password, processName, resolution, notes),
    // Persist custom game order (expects array of steamIDs in desired order)
    saveGameOrder: (steamIDs) => electron_1.ipcRenderer.invoke('save-game-order', steamIDs),
    // Securely fetch stored password for a game/user (on demand)
    getStoredPassword: (steamID, user) => electron_1.ipcRenderer.invoke('get-stored-password', steamID, user),
    // Toggle hidden status of a game
    toggleHidden: (steamID) => electron_1.ipcRenderer.invoke('toggle-hidden', steamID),
    // Get all games including hidden ones
    getAllGames: () => electron_1.ipcRenderer.invoke('get-all-games'),
    // Refresh games from disk
    refreshGames: () => electron_1.ipcRenderer.invoke('refresh-games'),
    // Listen for config updated event
    onConfigUpdated: (callback) => {
        electron_1.ipcRenderer.on('config-updated', () => callback());
    },
    // Launching status events (per-game index)
    onLaunchingStarted: (callback) => {
        electron_1.ipcRenderer.on('launching-started', (_e, index) => callback(index));
    },
    onLaunchingStopped: (callback) => {
        electron_1.ipcRenderer.on('launching-stopped', (_e, index) => callback(index));
    },
    // Listen for configure game event
    onConfigureGame: (callback) => {
        electron_1.ipcRenderer.on('configure-game', (event, game, index) => callback(game, index));
    },
    // Trigger game update
    updateGame: (steamID) => electron_1.ipcRenderer.invoke('update-game', steamID),
    // Submit Steam Guard code
    submitSteamGuard: (steamID, code) => electron_1.ipcRenderer.invoke('submit-steam-guard', steamID, code),
    // Cancel game update
    cancelUpdate: (steamID) => electron_1.ipcRenderer.invoke('cancel-update', steamID),
    // Listen for update progress events
    onUpdateProgress: (callback) => {
        electron_1.ipcRenderer.on('update-progress', (event, data) => callback(data));
    },
    // Listen for Steam Guard interactive prompt request
    onSteamGuardRequired: (callback) => {
        electron_1.ipcRenderer.on('steam-guard-required', (event, data) => callback(data));
    },
    // Get application version from package.json
    getAppVersion: () => electron_1.ipcRenderer.invoke('get-app-version')
});
//# sourceMappingURL=preload.js.map
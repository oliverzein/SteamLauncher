"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/ban-ts-comment */
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const node_path_1 = __importDefault(require("node:path"));
const electron_squirrel_startup_1 = __importDefault(require("electron-squirrel-startup"));
const classes_1 = require("./classes");
const helpers_1 = require("./utils/helpers");
const config_service_1 = require("./services/config.service");
const steam_service_1 = require("./services/steam.service");
const update_service_1 = require("./services/update.service");
// Reduce Chromium/Electron log verbosity (set before 'ready')
electron_1.app.commandLine.appendSwitch('log-level', '3');
electron_1.app.commandLine.appendSwitch('v', '0');
let mainWindow = null;
let steamStarters = [];
let tray = null;
let isQuitting = false;
function getGameForVisibleIndex(index) {
    const starter = steamStarters[index];
    if (!starter)
        return undefined;
    return config_service_1.configService.getConfig().steamApps.find(g => g.steamID === starter.steamID);
}
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (electron_squirrel_startup_1.default) {
    electron_1.app.quit();
}
const createSettingsWindow = () => {
    const settingsWin = new electron_1.BrowserWindow({
        width: 600,
        height: 600,
        icon: (0, helpers_1.getAppIconPath)(),
        autoHideMenuBar: true,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    // @ts-ignore
    if (SETTINGS_WINDOW_VITE_DEV_SERVER_URL) {
        // @ts-ignore
        settingsWin.loadURL(SETTINGS_WINDOW_VITE_DEV_SERVER_URL);
    }
    else {
        // @ts-ignore
        const name = SETTINGS_WINDOW_VITE_NAME;
        settingsWin.loadFile(node_path_1.default.join(__dirname, `../renderer/${name}/index.html`));
    }
};
const createConfigureWindow = (index) => {
    const configureWin = new electron_1.BrowserWindow({
        width: 600,
        height: 600,
        icon: (0, helpers_1.getAppIconPath)(),
        autoHideMenuBar: true,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    // @ts-ignore
    if (CONFIGURE_WINDOW_VITE_DEV_SERVER_URL) {
        // @ts-ignore
        configureWin.loadURL(CONFIGURE_WINDOW_VITE_DEV_SERVER_URL);
    }
    else {
        // @ts-ignore
        const name = CONFIGURE_WINDOW_VITE_NAME;
        configureWin.loadFile(node_path_1.default.join(__dirname, `../renderer/${name}/index.html`));
    }
    configureWin.show();
    configureWin.focus();
    configureWin.webContents.on('did-finish-load', () => {
        const game = config_service_1.configService.getConfig().steamApps[index];
        configureWin.webContents.send('configure-game', game, index);
    });
};
const createWindow = () => {
    mainWindow = new electron_1.BrowserWindow({
        width: 1600,
        height: 600,
        icon: (0, helpers_1.getAppIconPath)(),
        autoHideMenuBar: true,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    mainWindow.on('close', (e) => {
        // @ts-ignore
        if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
            return;
        }
        if (!isQuitting) {
            e.preventDefault();
            mainWindow?.hide();
            mainWindow?.setSkipTaskbar(true);
        }
    });
    mainWindow.on('minimize', () => {
        // @ts-ignore
        if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
            return;
        if (!isQuitting) {
            mainWindow?.hide();
            mainWindow?.setSkipTaskbar(true);
        }
    });
    mainWindow.on('show', () => {
        mainWindow?.setSkipTaskbar(false);
    });
    // @ts-ignore
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        try {
            const ses = mainWindow.webContents.session;
            ses.clearCache();
            ses.clearStorageData({
                storages: ['serviceworkers', 'cachestorage']
            });
        }
        catch {
            // Ignore
        }
        // @ts-ignore
        const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL.includes('?')
            // @ts-ignore
            ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}&t=${Date.now()}`
            // @ts-ignore
            : `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?t=${Date.now()}`;
        // @ts-ignore
        (0, helpers_1.waitForDevServer)(MAIN_WINDOW_VITE_DEV_SERVER_URL).then(() => {
            if (!mainWindow?.isDestroyed())
                mainWindow?.loadURL(devUrl);
        }).catch(() => {
            if (!mainWindow?.isDestroyed())
                mainWindow?.loadURL(devUrl);
        });
        let lastDevReload = 0;
        mainWindow.webContents.on('console-message', (_event, _level, message) => {
            if (typeof message === 'string' && message.includes('Outdated Optimize Dep')) {
                const now = Date.now();
                if (now - lastDevReload > 2000) {
                    lastDevReload = now;
                    mainWindow?.webContents.reloadIgnoringCache();
                }
            }
        });
        let retriedFailLoad = false;
        mainWindow.webContents.on('did-fail-load', () => {
            if (!retriedFailLoad) {
                retriedFailLoad = true;
                setTimeout(() => {
                    if (!mainWindow?.isDestroyed()) {
                        mainWindow?.webContents.reloadIgnoringCache();
                    }
                }, 500);
            }
        });
        let watchdogTriggered = false;
        mainWindow.webContents.on('did-finish-load', () => {
            setTimeout(async () => {
                const win = mainWindow;
                if (watchdogTriggered || !win || win.isDestroyed())
                    return;
                try {
                    const contentLen = await win.webContents.executeJavaScript('document.body && document.body.innerText ? document.body.innerText.trim().length : 0', true);
                    if (contentLen < 5) {
                        watchdogTriggered = true;
                        win.webContents.reloadIgnoringCache();
                    }
                }
                catch { /* ignore */ }
            }, 1200);
        });
    }
    else {
        // @ts-ignore
        mainWindow.loadFile(node_path_1.default.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
    }
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('games-loaded', config_service_1.configService.getVisibleGamesSorted());
        steam_service_1.steamService.triggerBackgroundUpdateChecks(false);
    });
};
electron_1.app.whenReady().then(async () => {
    electron_1.Menu.setApplicationMenu(null);
    const registerDevtoolsShortcuts = () => {
        const toggleFocusedDevTools = () => {
            const win = electron_1.BrowserWindow.getFocusedWindow();
            if (win) {
                if (win.webContents.isDevToolsOpened())
                    win.webContents.closeDevTools();
                else
                    win.webContents.openDevTools({ mode: 'detach' });
            }
        };
        electron_1.globalShortcut.register('CommandOrControl+Shift+I', toggleFocusedDevTools);
        electron_1.globalShortcut.register('F12', toggleFocusedDevTools);
    };
    registerDevtoolsShortcuts();
    const iconPath = (0, helpers_1.getAppIconPath)();
    if (iconPath) {
        const trayImage = electron_1.nativeImage.createFromPath(iconPath);
        tray = new electron_1.Tray(trayImage);
        tray.setToolTip('Steam Game Launcher');
        const contextMenu = electron_1.Menu.buildFromTemplate([
            {
                label: 'Show',
                click: () => {
                    if (!mainWindow || mainWindow.isDestroyed()) {
                        createWindow();
                    }
                    mainWindow?.show();
                    mainWindow?.setSkipTaskbar(false);
                    mainWindow?.focus();
                },
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    isQuitting = true;
                    electron_1.app.quit();
                },
            },
        ]);
        tray.setContextMenu(contextMenu);
        tray.on('click', () => {
            if (!mainWindow || mainWindow.isDestroyed()) {
                createWindow();
            }
            if (mainWindow?.isVisible()) {
                mainWindow.focus();
            }
            else {
                mainWindow?.show();
                mainWindow?.setSkipTaskbar(false);
            }
        });
    }
    config_service_1.configService.loadConfig();
    const games = await steam_service_1.steamService.fetchGames();
    steamStarters = games.map(game => new classes_1.SteamStarter(game.user, game.steamID, 'steam'));
    createWindow();
    if (mainWindow) {
        if (config_service_1.configService.getConfig().startMinimized) {
            mainWindow.hide();
            mainWindow.setSkipTaskbar(true);
        }
    }
});
// IPC Handlers
electron_1.ipcMain.handle('start-game', async (event, index) => {
    try {
        if (typeof index !== 'number' || !Number.isInteger(index)) {
            return { success: false, error: 'Invalid index type' };
        }
        if (index < 0 || index >= steamStarters.length) {
            return { success: false, error: 'Index out of range' };
        }
        const starter = steamStarters[index];
        if (!starter) {
            return { success: false, error: 'Game starter not available' };
        }
        const gameForUser = getGameForVisibleIndex(index);
        if (gameForUser?.user) {
            await steam_service_1.steamService.ensureSteamUserOrShutdown(gameForUser.user);
        }
        if (gameForUser) {
            await steam_service_1.steamService.applyResolutionIfConfigured(gameForUser);
        }
        const launchEventPayload = { index, steamID: starter.steamID };
        electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-started', launchEventPayload));
        const result = await starter.execute();
        const game = getGameForVisibleIndex(index);
        const configured = game?.processName?.trim();
        const fallback = (process.platform === 'win32' ? 'steam.exe' : 'steam');
        const procName = configured && configured.length > 0 ? configured : fallback;
        if (result.success) {
            const start = Date.now();
            const timeoutMs = 120000;
            const initialDelayMs = 4000;
            const cmd = (0, helpers_1.buildPgrepCmd)(procName);
            const tick = () => {
                if (Date.now() - start > timeoutMs) {
                    electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload));
                    return;
                }
                (0, child_process_1.exec)(cmd, (err, stdout) => {
                    const out = (stdout || '').trim();
                    if (out.length > 0) {
                        electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload));
                    }
                    else {
                        setTimeout(tick, 1500);
                    }
                });
            };
            setTimeout(tick, initialDelayMs);
        }
        else {
            electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload));
        }
        return result;
    }
    catch (error) {
        const launchEventPayload = { index, steamID: steamStarters[index]?.steamID };
        electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload));
        return { success: false, error: error.message };
    }
});
electron_1.ipcMain.handle('get-config', async () => {
    return config_service_1.configService.getConfig();
});
electron_1.ipcMain.handle('save-config', async (event, newConfig) => {
    if (newConfig && Array.isArray(newConfig.compatdataPaths)) {
        const valid = newConfig.compatdataPaths.every((p) => typeof p === 'string' && p.length > 0);
        if (!valid) {
            return { success: false, error: 'compatdataPaths must be a non-empty array of strings' };
        }
    }
    if (newConfig && 'startMinimized' in newConfig && typeof newConfig.startMinimized !== 'boolean') {
        return { success: false, error: 'startMinimized must be a boolean' };
    }
    config_service_1.configService.saveConfig(newConfig);
    const games = await steam_service_1.steamService.fetchGames();
    steamStarters = games.map(game => new classes_1.SteamStarter(game.user, game.steamID, 'steam'));
    if (mainWindow) {
        mainWindow.webContents.send('games-loaded', games);
    }
    return { success: true };
});
electron_1.ipcMain.handle('open-configure', async (event, steamID) => {
    if (typeof steamID !== 'number' || !Number.isInteger(steamID) || steamID <= 0) {
        return { success: false, error: 'Invalid steamID' };
    }
    const index = config_service_1.configService.getConfig().steamApps.findIndex(g => g.steamID === steamID);
    if (index === -1) {
        return { success: false, error: 'Game not found' };
    }
    createConfigureWindow(index);
    return { success: true };
});
electron_1.ipcMain.handle('save-game-config', async (event, index, user, password, processName, resolution, notes) => {
    const config = config_service_1.configService.getConfig();
    if (typeof index !== 'number' || !Number.isInteger(index)) {
        return { success: false, error: 'Invalid index type' };
    }
    if (index < 0 || index >= config.steamApps.length) {
        return { success: false, error: 'Index out of range' };
    }
    if (typeof user !== 'string' || typeof password !== 'string') {
        return { success: false, error: 'Invalid credentials type' };
    }
    const steamID = config.steamApps[index].steamID;
    config.steamApps[index].user = user;
    if (typeof processName === 'string') {
        const pn = processName.trim();
        config.steamApps[index].processName = pn.length ? pn : undefined;
    }
    if (typeof resolution === 'string') {
        const rs = resolution.trim();
        config.steamApps[index].resolution = rs.length ? rs : undefined;
    }
    if (typeof notes === 'string') {
        const ns = notes.trim();
        config.steamApps[index].notes = ns.length ? ns : undefined;
    }
    if (password && password.length > 0) {
        try {
            const keytar = (0, classes_1.loadKeytar)();
            await keytar.setPassword('steamlauncher', `${user}:${steamID}`, password);
        }
        catch (e) {
            return { success: false, error: 'Failed to store password in keychain' };
        }
    }
    config_service_1.configService.saveConfig();
    electron_1.BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('config-updated');
    });
    return { success: true };
});
electron_1.ipcMain.handle('save-game-order', async (_event, steamIDs) => {
    const config = config_service_1.configService.getConfig();
    if (!Array.isArray(steamIDs)) {
        throw new Error('Order payload must be an array');
    }
    const seen = new Set();
    for (const id of steamIDs) {
        if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
            throw new Error('Order payload must contain positive integer steamIDs');
        }
        if (seen.has(id)) {
            throw new Error('Duplicate steamIDs provided in order payload');
        }
        const exists = config.steamApps.some(game => game.steamID === id);
        if (!exists) {
            throw new Error(`Unknown steamID ${id} in order payload`);
        }
        seen.add(id);
    }
    let order = 0;
    for (const id of steamIDs) {
        const game = config.steamApps.find(g => g.steamID === id);
        if (game) {
            game.order = order++;
        }
    }
    const remaining = config.steamApps
        .filter(game => !seen.has(game.steamID))
        .sort(config_service_1.configService.compareByOrder);
    for (const game of remaining) {
        game.order = order++;
    }
    config_service_1.configService.saveConfig();
    const visible = config_service_1.configService.getVisibleGamesSorted();
    steamStarters = visible.map(game => new classes_1.SteamStarter(game.user, game.steamID, 'steam'));
    electron_1.BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('games-loaded', visible);
        win.webContents.send('config-updated');
    });
});
electron_1.ipcMain.handle('get-stored-password', async (event, steamID, user) => {
    try {
        if (typeof steamID !== 'number' || !Number.isInteger(steamID) || steamID <= 0) {
            return { success: false, error: 'Invalid steamID' };
        }
        if (typeof user !== 'string' || user.length === 0) {
            return { success: false, error: 'Invalid user' };
        }
        const keytar = (0, classes_1.loadKeytar)();
        const account = `${user}:${steamID}`;
        const password = await keytar.getPassword('steamlauncher', account);
        if (!password)
            return { success: false, error: 'No password set' };
        return { success: true, password };
    }
    catch (e) {
        return { success: false, error: 'Failed to retrieve password' };
    }
});
electron_1.ipcMain.handle('toggle-hidden', async (event, steamID) => {
    const config = config_service_1.configService.getConfig();
    if (typeof steamID !== 'number' || !Number.isInteger(steamID) || steamID <= 0) {
        return { success: false, error: 'Invalid steamID' };
    }
    const index = config.steamApps.findIndex(g => g.steamID === steamID);
    if (index === -1) {
        return { success: false, error: 'Game not found' };
    }
    const game = config.steamApps[index];
    game.hidden = !game.hidden;
    config_service_1.configService.saveConfig();
    const updatedGames = await steam_service_1.steamService.fetchGames();
    steamStarters = updatedGames.map(g => new classes_1.SteamStarter(g.user, g.steamID, 'steam'));
    mainWindow?.webContents.send('games-loaded', updatedGames);
    electron_1.BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('config-updated');
    });
    return { success: true };
});
electron_1.ipcMain.handle('get-all-games', () => {
    return config_service_1.configService.getConfig().steamApps;
});
electron_1.ipcMain.handle('open-settings', async () => {
    createSettingsWindow();
});
electron_1.ipcMain.handle('start-steam-only', async (_event, index) => {
    try {
        if (typeof index !== 'number' || !Number.isInteger(index)) {
            return { success: false, error: 'Invalid index type' };
        }
        if (index < 0 || index >= steamStarters.length) {
            return { success: false, error: 'Index out of range' };
        }
        const starter = steamStarters[index];
        if (!starter) {
            return { success: false, error: 'Game starter not available' };
        }
        electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-started', index));
        const game = getGameForVisibleIndex(index);
        if (game) {
            await steam_service_1.steamService.applyResolutionIfConfigured(game);
        }
        const result = await starter.executeSteamOnly();
        const procName = process.platform === 'win32' ? 'steam.exe' : 'steam';
        if (result.success) {
            const start = Date.now();
            const timeoutMs = 120000;
            const initialDelayMs = 4000;
            const cmd = (0, helpers_1.buildPgrepCmd)(procName);
            const tick = () => {
                if (Date.now() - start > timeoutMs) {
                    electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index));
                    return;
                }
                (0, child_process_1.exec)(cmd, (err, stdout) => {
                    const out = (stdout || '').trim();
                    if (out.length > 0) {
                        electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index));
                    }
                    else {
                        setTimeout(tick, 1500);
                    }
                });
            };
            setTimeout(tick, initialDelayMs);
        }
        else {
            electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index));
        }
        return result;
    }
    catch (e) {
        electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index));
        return { success: false, error: e.message };
    }
});
electron_1.ipcMain.handle('update-game', async (event, steamID) => {
    return update_service_1.updateService.updateGame(steamID);
});
electron_1.ipcMain.handle('submit-steam-guard', async (event, steamID, code) => {
    return update_service_1.updateService.submitSteamGuard(steamID, code);
});
electron_1.ipcMain.handle('cancel-update', async (event, steamID) => {
    return update_service_1.updateService.cancelUpdate(steamID);
});
electron_1.ipcMain.handle('get-app-version', () => {
    return electron_1.app.getVersion();
});
electron_1.ipcMain.handle('refresh-games', async () => {
    const games = await steam_service_1.steamService.fetchGames();
    steamStarters = games.map(game => new classes_1.SteamStarter(game.user, game.steamID, 'steam'));
    electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('games-loaded', games));
    steam_service_1.steamService.triggerBackgroundUpdateChecks(true);
    return { success: true, count: games.length };
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (!tray) {
            electron_1.app.quit();
        }
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
electron_1.app.on('will-quit', () => {
    electron_1.globalShortcut.unregisterAll();
});
electron_1.app.on('before-quit', () => {
    isQuitting = true;
});
//# sourceMappingURL=main.js.map
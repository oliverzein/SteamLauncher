"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/ban-ts-comment */
// In dev, wait for the Vite dev server to respond with a non-504 before loading the URL
function waitForDevServer(urlStr, overallTimeoutMs = 10000, retryIntervalMs = 200) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const attempt = () => {
            try {
                const u = new URL(urlStr);
                const getter = u.protocol === 'https:' ? https.get : http.get;
                const req = getter(urlStr, (res) => {
                    // Accept any successful-ish code below 500; specifically avoid 5xx like 504
                    if (res.statusCode && res.statusCode < 500) {
                        res.resume(); // drain
                        return resolve();
                    }
                    res.resume();
                    if (Date.now() - start > overallTimeoutMs)
                        return reject(new Error(`Dev server not ready: ${res.statusCode}`));
                    setTimeout(attempt, retryIntervalMs);
                });
                req.on('error', () => {
                    if (Date.now() - start > overallTimeoutMs)
                        return reject(new Error('Dev server not reachable'));
                    setTimeout(attempt, retryIntervalMs);
                });
            }
            catch {
                if (Date.now() - start > overallTimeoutMs)
                    return reject(new Error('Dev server URL invalid'));
                setTimeout(attempt, retryIntervalMs);
            }
        };
        attempt();
    });
}
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const node_path_1 = __importDefault(require("node:path"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const os = __importStar(require("os"));
const electron_squirrel_startup_1 = __importDefault(require("electron-squirrel-startup"));
const classes_1 = require("./classes");
// Reduce Chromium/Electron log verbosity (set before 'ready')
// log-level 3 = warnings and above; v=0 disables extra verbose logs
electron_1.app.commandLine.appendSwitch('log-level', '3');
electron_1.app.commandLine.appendSwitch('v', '0');
let mainWindow = null;
let steamStarters = [];
let config = {
    compatdataPaths: ['~/.local/share/Steam/steamapps/compatdata/'],
    steamApps: [],
    startMinimized: false,
};
let tray = null;
let isQuitting = false;
// Verbose logging toggle (set SL_VERBOSE=1 to enable)
const VERBOSE = !!process.env.SL_VERBOSE;
const vlog = (...args) => { if (VERBOSE)
    console.log('[verbose]', ...args); };
const compareByOrder = (a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
    if (ao !== bo)
        return ao - bo;
    return a.name.localeCompare(b.name);
};
const getNextOrderValue = () => {
    let max = -1;
    for (const game of config.steamApps) {
        if (typeof game.order === 'number' && game.order > max) {
            max = game.order;
        }
    }
    return max + 1;
};
const reindexGameOrders = () => {
    const sorted = [...config.steamApps].sort(compareByOrder);
    sorted.forEach((game, index) => {
        game.order = index;
    });
};
const getVisibleGamesSorted = () => {
    return config.steamApps.filter(game => !game.hidden).sort(compareByOrder);
};
// Run a shell command and resolve when done
function run(cmd) {
    return new Promise((resolve) => {
        (0, child_process_1.exec)(cmd, (error, stdout, stderr) => {
            resolve({ code: error ? error.code ?? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
        });
    });
}
// Build a robust pgrep command that searches the full command line (works with Wine/Proton)
function buildPgrepCmd(raw) {
    const name = node_path_1.default.basename(raw);
    const escaped = name.replace(/'/g, "'\\''");
    // -f: search full cmdline, -i: case-insensitive (handles wine path case)
    return `pgrep -fi '${escaped}'`;
}
// Map the renderer-visible index (filtered list) to the true config entry using steamID
function getGameForVisibleIndex(index) {
    const starter = steamStarters[index];
    if (!starter)
        return undefined;
    return config.steamApps.find(g => g.steamID === starter.steamID);
}
// Try to read the running Steam login from the steam process command line
async function getRunningSteamLogin() {
    return new Promise((resolve) => {
        // -x exact name, -a print command line
        (0, child_process_1.exec)("pgrep -x -a steam", (err, stdout) => {
            if (err || !stdout)
                return resolve(null);
            const lines = stdout.split('\n').filter(Boolean);
            for (const line of lines) {
                // Example: "4170 /path/to/steam -srt-logger-opened -login user pass"
                const after = line.split(' -login ')[1];
                if (after) {
                    const parts = after.trim().split(/\s+/);
                    if (parts.length > 0) {
                        return resolve(parts[0]);
                    }
                }
            }
            resolve(null);
        });
    });
}
// If Steam is running with a different login than desired, request shutdown and wait for exit
async function ensureSteamUserOrShutdown(desiredUser) {
    try {
        const runningUser = await getRunningSteamLogin();
        if (!runningUser)
            return; // no steam or cannot detect; proceed
        if (runningUser === desiredUser)
            return; // already correct account
        // Different account: request shutdown and wait until gone
        (0, child_process_1.exec)('steam -shutdown', () => { });
        const start = Date.now();
        const timeoutMs = 30000;
        const waitTick = () => {
            (0, child_process_1.exec)("pgrep -x steam", (err, stdout) => {
                const stillRunning = !err && !!(stdout && stdout.trim().length > 0);
                if (!stillRunning)
                    return;
                if (Date.now() - start > timeoutMs)
                    return;
                setTimeout(waitTick, 500);
            });
        };
        await new Promise((resolve) => {
            const loop = () => {
                (0, child_process_1.exec)("pgrep -x steam", (err, stdout) => {
                    const stillRunning = !err && !!(stdout && stdout.trim().length > 0);
                    if (!stillRunning)
                        return resolve();
                    if (Date.now() - start > timeoutMs)
                        return resolve();
                    setTimeout(loop, 500);
                });
            };
            loop();
        });
    }
    catch {
        // Ignore failures; proceed to launch
    }
}
// If the game has a resolution configured, apply it using kscreen-doctor
async function applyResolutionIfConfigured(index) {
    try {
        const game = getGameForVisibleIndex(index);
        const res = game?.resolution?.trim();
        if (!res)
            return;
        const { code, stderr } = await run(`kscreen-doctor ${res}`);
        if (code !== 0) {
            // silently ignore non-zero exit
        }
    }
    catch (e) {
        // silently ignore resolution errors
    }
}
// Get the local buildID from the appmanifest file on disk
function getLocalBuildID(steamID) {
    try {
        for (const cp of config.compatdataPaths) {
            const fullPath = cp.replace('~', os.homedir());
            const steamappsDir = node_path_1.default.resolve(fullPath, '..');
            const acfPath = node_path_1.default.join(steamappsDir, `appmanifest_${steamID}.acf`);
            if (fs.existsSync(acfPath)) {
                const content = fs.readFileSync(acfPath, 'utf8');
                const match = content.match(/^\s*"buildid"\s*"(\d+)"/mi);
                if (match) {
                    return match[1];
                }
            }
        }
    }
    catch (error) {
        if (VERBOSE)
            console.error(`Failed to get local build ID for ${steamID}:`, error);
    }
    return null;
}
// Fetch the remote buildID from Steam Web-API with local SteamCMD fallback
function getRemoteBuildID(steamID) {
    return new Promise((resolve) => {
        const url = `https://api.steamcmd.net/v1/info/${steamID}`;
        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.status === 'success' && json.data?.[steamID]?.depots?.branches?.public?.buildid) {
                        const buildID = String(json.data[steamID].depots.branches.public.buildid);
                        if (VERBOSE)
                            vlog(`Fetched remote buildID ${buildID} for AppID ${steamID} from Web-API`);
                        return resolve(buildID);
                    }
                }
                catch (e) {
                    if (VERBOSE)
                        console.error(`Failed to parse Web-API JSON for AppID ${steamID}:`, e);
                }
                runSteamcmdFallback();
            });
        });
        req.on('error', (err) => {
            if (VERBOSE)
                console.error(`Web-API error for AppID ${steamID}:`, err);
            runSteamcmdFallback();
        });
        req.setTimeout(5000, () => {
            if (VERBOSE)
                console.warn(`Web-API timeout for AppID ${steamID}`);
            req.destroy();
            runSteamcmdFallback();
        });
        const runSteamcmdFallback = () => {
            if (VERBOSE)
                vlog(`Running steamcmd fallback to get remote buildID for AppID ${steamID}`);
            const cmd = `steamcmd +login anonymous +app_info_update 1 +app_info_print ${steamID} +quit`;
            const tempHome = node_path_1.default.join(electron_1.app.getPath('userData'), 'steamcmd_home');
            try {
                fs.mkdirSync(tempHome, { recursive: true });
            }
            catch (err) {
                // Ignore folder already exists errors
            }
            (0, child_process_1.exec)(cmd, { env: { ...process.env, HOME: tempHome } }, (error, stdout) => {
                if (error) {
                    if (VERBOSE)
                        console.error(`SteamCMD fallback execution failed for AppID ${steamID}:`, error);
                    return resolve(null);
                }
                try {
                    const publicIdx = stdout.indexOf('"public"');
                    if (publicIdx !== -1) {
                        const afterPublic = stdout.substring(publicIdx);
                        const match = afterPublic.match(/"buildid"\s*"(\d+)"/i);
                        if (match) {
                            const buildID = match[1];
                            if (VERBOSE)
                                vlog(`Fetched remote buildID ${buildID} for AppID ${steamID} from SteamCMD`);
                            return resolve(buildID);
                        }
                    }
                    const simpleMatch = stdout.match(/"buildid"\s*"(\d+)"/i);
                    if (simpleMatch) {
                        return resolve(simpleMatch[1]);
                    }
                }
                catch (e) {
                    if (VERBOSE)
                        console.error(`Failed to parse SteamCMD output for AppID ${steamID}:`, e);
                }
                resolve(null);
            });
        };
    });
}
// Compare local and remote buildID to check for updates and update config
async function checkGameUpdate(steamID, force = false) {
    const game = config.steamApps.find(g => g.steamID === steamID);
    if (!game)
        return false;
    const now = Date.now();
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    if (!force && game.lastUpdateCheck && (now - game.lastUpdateCheck < twelveHoursMs)) {
        if (VERBOSE)
            vlog(`Skipping update check for AppID ${steamID} (already checked recently)`);
        return !!game.updateAvailable;
    }
    const localBuildID = getLocalBuildID(steamID);
    if (!localBuildID) {
        if (VERBOSE)
            vlog(`No local buildID found for AppID ${steamID}`);
        return false;
    }
    const remoteBuildID = await getRemoteBuildID(steamID);
    if (!remoteBuildID) {
        if (VERBOSE)
            console.warn(`Failed to fetch remote buildID for AppID ${steamID}`);
        return !!game.updateAvailable;
    }
    const updateAvailable = localBuildID !== remoteBuildID;
    const oldUpdate = game.updateAvailable;
    const oldCheck = game.lastUpdateCheck;
    game.updateAvailable = updateAvailable;
    game.lastUpdateCheck = now;
    if (oldUpdate !== updateAvailable || oldCheck !== now) {
        saveConfig();
    }
    if (VERBOSE) {
        vlog(`AppID ${steamID} buildID compare: Local=${localBuildID}, Remote=${remoteBuildID}. UpdateAvailable=${updateAvailable}`);
    }
    return updateAvailable;
}
// Perform background update checks for all visible games and notify windows reactively
async function triggerBackgroundUpdateChecks(force = false) {
    if (VERBOSE)
        vlog(`Starting background update checks (force=${force}) for all games...`);
    const visible = getVisibleGamesSorted();
    for (const game of visible) {
        try {
            await checkGameUpdate(game.steamID, force);
            electron_1.BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('games-loaded', getVisibleGamesSorted());
            });
        }
        catch (e) {
            if (VERBOSE)
                console.error(`Error checking update for AppID ${game.steamID}:`, e);
        }
    }
}
// Load config from file
function loadConfig() {
    try {
        const configPath = node_path_1.default.join(electron_1.app.getPath('userData'), 'config.json');
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf8');
            const parsed = JSON.parse(data);
            // Backward compatibility: convert old compatdataPath to compatdataPaths
            if (parsed.compatdataPath && !parsed.compatdataPaths) {
                parsed.compatdataPaths = [parsed.compatdataPath];
                delete parsed.compatdataPath;
            }
            config = { ...config, ...parsed };
            reindexGameOrders();
            saveConfig();
        }
    }
    catch (error) {
        console.error('Failed to load config:', error);
    }
}
// Save config to file (sanitize legacy password fields)
function saveConfig() {
    try {
        const configPath = node_path_1.default.join(electron_1.app.getPath('userData'), 'config.json');
        const sanitized = {
            ...config,
            steamApps: config.steamApps.map(g => ({
                name: g.name,
                icon: g.icon,
                user: g.user,
                steamID: g.steamID,
                hidden: g.hidden ?? false,
                processName: g.processName,
                resolution: g.resolution,
                notes: g.notes,
                order: typeof g.order === 'number' ? g.order : undefined,
                updateAvailable: g.updateAvailable,
                lastUpdateCheck: g.lastUpdateCheck,
            })),
        };
        fs.writeFileSync(configPath, JSON.stringify(sanitized, null, 2));
    }
    catch (error) {
        if (VERBOSE)
            console.error('Failed to save config:', error);
    }
}
// Fetch game details from Steam API
async function fetchAppDetails(steamID) {
    return new Promise((resolve, reject) => {
        const url = `https://store.steampowered.com/api/appdetails?appids=${steamID}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json[steamID]?.success) {
                        const name = json[steamID].data.name;
                        const icon = json[steamID].data.header_image;
                        resolve({ name, icon });
                    }
                    else {
                        resolve({ name: `Game ${steamID}` });
                    }
                }
                catch (e) {
                    if (VERBOSE)
                        console.error(`Failed API for steamID ${steamID}:`, e);
                    resolve({ name: `Game ${steamID}` });
                }
            });
        }).on('error', (err) => {
            if (VERBOSE)
                console.error(`Failed API for steamID ${steamID}:`, err);
            resolve({ name: `Game ${steamID}` });
        });
    });
}
// Fetch games from all compatdata paths
async function fetchGames() {
    const games = [];
    const steamIDs = new Set();
    for (const path of config.compatdataPaths) {
        try {
            const fullPath = path.replace('~', os.homedir());
            if (VERBOSE)
                vlog(`Using compatdata path: ${fullPath}`);
            const entries = fs.readdirSync(fullPath);
            if (VERBOSE)
                vlog(`Found ${entries.length} entries in compatdata`);
            const filteredEntries = entries.filter(entry => /^\d+$/.test(entry));
            if (VERBOSE)
                vlog(`Filtered steamIDs: [ ${filteredEntries.join(', ')} ]`);
            for (const entry of filteredEntries) {
                const steamID = parseInt(entry);
                if (steamID > 0 && steamID !== 1493710 && !steamIDs.has(steamID)) {
                    steamIDs.add(steamID);
                    // Find existing game config or create default
                    let gameConfig = config.steamApps.find(g => g.steamID === steamID);
                    if (!gameConfig) {
                        gameConfig = {
                            name: `Game ${steamID}`,
                            user: 'default_user',
                            steamID: steamID,
                            hidden: false,
                            processName: undefined,
                            order: getNextOrderValue(),
                        };
                        config.steamApps.push(gameConfig);
                    }
                    if (typeof gameConfig.order !== 'number') {
                        gameConfig.order = getNextOrderValue();
                    }
                    // Fetch latest game details
                    const details = await fetchAppDetails(steamID);
                    gameConfig.name = details.name;
                    gameConfig.icon = details.icon;
                    if (!gameConfig.hidden) {
                        games.push(gameConfig);
                    }
                }
            }
        }
        catch (error) {
            if (VERBOSE)
                console.error(`Failed to read compatdata path ${path}:`, error);
        }
    }
    reindexGameOrders();
    games.sort(compareByOrder);
    return games;
}
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (electron_squirrel_startup_1.default) {
    electron_1.app.quit();
}
const createSettingsWindow = () => {
    const settingsWin = new electron_1.BrowserWindow({
        width: 600,
        height: 600,
        icon: getAppIconPath(),
        autoHideMenuBar: true,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    // Load via Vite renderer target
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
        icon: getAppIconPath(),
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
        const game = config.steamApps[index];
        configureWin.webContents.send('configure-game', game, index);
    });
};
// Resolve an asset path both in dev and in packaged builds
function resolveAsset(...segments) {
    const devPath = node_path_1.default.join(__dirname, '..', '..', 'assets', ...segments);
    const prodPath = node_path_1.default.join(process.resourcesPath, 'assets', ...segments);
    return fs.existsSync(devPath) ? devPath : prodPath;
}
function getAppIconPath() {
    // Prefer PNG (SVG is not supported widely for window icons)
    const pngPath = resolveAsset('app-icon.png');
    if (fs.existsSync(pngPath))
        return pngPath;
    // Fallback to any png in assets dir
    const altPng = resolveAsset('icon.png');
    if (fs.existsSync(altPng))
        return altPng;
    return undefined;
}
const createWindow = () => {
    // Create the browser window.
    mainWindow = new electron_1.BrowserWindow({
        width: 1600,
        height: 600,
        icon: getAppIconPath(),
        autoHideMenuBar: true,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    // Intercept close to minimize to tray instead of quitting (disabled in dev to avoid leftover instances)
    mainWindow.on('close', (e) => {
        if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
            // In dev, let the window close normally so the app exits cleanly
            return;
        }
        if (!isQuitting) {
            e.preventDefault();
            mainWindow?.hide();
            mainWindow?.setSkipTaskbar(true);
        }
    });
    // Intercept minimize to hide to tray (disabled in dev)
    mainWindow.on('minimize', () => {
        if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
            return;
        if (!isQuitting) {
            mainWindow?.hide();
            mainWindow?.setSkipTaskbar(true);
        }
    });
    // Ensure it reappears in taskbar when shown
    mainWindow.on('show', () => {
        mainWindow?.setSkipTaskbar(false);
    });
    // and load the index.html of the app.
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        // Clear HTTP and storage caches to avoid stale optimized deps between restarts
        try {
            const ses = mainWindow.webContents.session;
            ses.clearCache();
            ses.clearStorageData({
                storages: ['serviceworkers', 'cachestorage']
            });
        }
        catch {
            // Ignore cache clearing errors
        }
        // Add a cache-busting query parameter to avoid reusing stale bundles
        const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL.includes('?')
            ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}&t=${Date.now()}`
            : `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?t=${Date.now()}`;
        // Preflight: wait for dev server readiness to avoid intermittent 504
        waitForDevServer(MAIN_WINDOW_VITE_DEV_SERVER_URL).then(() => {
            if (!mainWindow.isDestroyed())
                mainWindow.loadURL(devUrl);
        }).catch(() => {
            // Even if preflight fails, attempt to load; the other safeguards may recover
            if (!mainWindow.isDestroyed())
                mainWindow.loadURL(devUrl);
        });
        // Dev resilience: sometimes Vite serves 504 "Outdated Optimize Dep" which leaves the page blank.
        // Listen for that console message and force a reload (throttled) to recover automatically.
        let lastDevReload = 0;
        mainWindow.webContents.on('console-message', (_event, _level, message) => {
            if (typeof message === 'string' && message.includes('Outdated Optimize Dep')) {
                const now = Date.now();
                if (now - lastDevReload > 2000) {
                    lastDevReload = now;
                    mainWindow.webContents.reloadIgnoringCache();
                }
            }
        });
        // Additionally, if the top-level load fails, retry once shortly after.
        let retriedFailLoad = false;
        mainWindow.webContents.on('did-fail-load', () => {
            if (!retriedFailLoad) {
                retriedFailLoad = true;
                setTimeout(() => {
                    if (!mainWindow.isDestroyed()) {
                        mainWindow.webContents.reloadIgnoringCache();
                    }
                }, 500);
            }
        });
        // Dev watchdog: if the page remains effectively blank shortly after load, reload once.
        let watchdogTriggered = false;
        mainWindow.webContents.on('did-finish-load', () => {
            setTimeout(async () => {
                if (watchdogTriggered || mainWindow.isDestroyed())
                    return;
                try {
                    const contentLen = await mainWindow.webContents.executeJavaScript('document.body && document.body.innerText ? document.body.innerText.trim().length : 0', true);
                    if (contentLen < 5) {
                        watchdogTriggered = true;
                        mainWindow.webContents.reloadIgnoringCache();
                    }
                }
                catch { /* ignore */ }
            }, 1200);
        });
    }
    else {
        // Use the renderer output folder provided by Forge Vite plugin
        // MAIN_WINDOW_VITE_NAME is injected at build time
        mainWindow.loadFile(node_path_1.default.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
    }
    // Open DevTools only in development
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        //mainWindow.webContents.openDevTools();
    }
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('games-loaded', getVisibleGamesSorted());
        triggerBackgroundUpdateChecks(false);
    });
};
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
electron_1.app.whenReady().then(async () => {
    // Remove default application menu
    electron_1.Menu.setApplicationMenu(null);
    // Register global shortcuts to toggle DevTools
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
    // Create system tray
    const iconPath = getAppIconPath();
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
    loadConfig();
    const games = await fetchGames();
    steamStarters = games.map(game => new classes_1.SteamStarter(game.user, game.steamID, 'steam'));
    createWindow();
    if (mainWindow) {
        // If user prefers start minimized, hide to tray immediately
        if (config.startMinimized) {
            mainWindow.hide();
            mainWindow.setSkipTaskbar(true);
        }
    }
});
// IPC handlers
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
        // Ensure Steam account matches configured game user; shutdown if different
        const gameForUser = getGameForVisibleIndex(index);
        if (gameForUser?.user) {
            await ensureSteamUserOrShutdown(gameForUser.user);
        }
        // Apply optional screen resolution before launching
        await applyResolutionIfConfigured(index);
        // Notify renderer after prep work has started
        const launchEventPayload = { index, steamID: starter.steamID };
        electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-started', launchEventPayload));
        const result = await starter.execute();
        // Start process watcher; fall back to Steam client if no per-game processName configured
        const game = getGameForVisibleIndex(index);
        const configured = game?.processName?.trim();
        const fallback = (process.platform === 'win32' ? 'steam.exe' : 'steam');
        const procName = configured && configured.length > 0 ? configured : fallback;
        if (result.success) {
            const start = Date.now();
            const timeoutMs = 120000; // 120s timeout
            const initialDelayMs = 4000;
            const cmd = buildPgrepCmd(procName);
            let attempt = 0;
            const tick = () => {
                attempt++;
                if (Date.now() - start > timeoutMs) {
                    electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload));
                    return;
                }
                (0, child_process_1.exec)(cmd, (err, stdout, stderr) => {
                    const out = (stdout || '').trim();
                    if (out.length > 0) {
                        electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload));
                    }
                    else {
                        setTimeout(tick, 1500);
                    }
                });
            };
            // Start after a short delay to give the process time to spawn
            setTimeout(tick, initialDelayMs);
        }
        else {
            // Stop immediately if failed
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
    return config;
});
electron_1.ipcMain.handle('save-config', async (event, newConfig) => {
    // Basic validation for compatdataPaths if present
    if (newConfig && Array.isArray(newConfig.compatdataPaths)) {
        const valid = newConfig.compatdataPaths.every((p) => typeof p === 'string' && p.length > 0);
        if (!valid) {
            return { success: false, error: 'compatdataPaths must be a non-empty array of strings' };
        }
    }
    // Validate startMinimized if provided
    if (newConfig && 'startMinimized' in newConfig && typeof newConfig.startMinimized !== 'boolean') {
        return { success: false, error: 'startMinimized must be a boolean' };
    }
    config = { ...config, ...newConfig };
    saveConfig();
    const games = await fetchGames();
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
    const index = config.steamApps.findIndex(g => g.steamID === steamID);
    if (index === -1) {
        return { success: false, error: 'Game not found' };
    }
    createConfigureWindow(index);
    return { success: true };
});
electron_1.ipcMain.handle('save-game-config', async (event, index, user, password, processName, resolution, notes) => {
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
    // Update user in config
    config.steamApps[index].user = user;
    // Update processName if provided (allow empty -> undefined)
    if (typeof processName === 'string') {
        const pn = processName.trim();
        config.steamApps[index].processName = pn.length ? pn : undefined;
    }
    // Update desired resolution string (allow empty -> undefined)
    if (typeof resolution === 'string') {
        const rs = resolution.trim();
        config.steamApps[index].resolution = rs.length ? rs : undefined;
    }
    // Update notes (allow empty -> undefined)
    if (typeof notes === 'string') {
        const ns = notes.trim();
        config.steamApps[index].notes = ns.length ? ns : undefined;
    }
    // If a non-empty password is provided, store it securely in keytar
    if (password && password.length > 0) {
        try {
            const keytar = (0, classes_1.loadKeytar)();
            await keytar.setPassword('steamlauncher', `${user}:${steamID}`, password);
        }
        catch (e) {
            return { success: false, error: 'Failed to store password in keychain' };
        }
    }
    saveConfig();
    // Notify all windows of config update
    electron_1.BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('config-updated');
    });
    return { success: true };
});
electron_1.ipcMain.handle('save-game-order', async (_event, steamIDs) => {
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
        .sort(compareByOrder);
    for (const game of remaining) {
        game.order = order++;
    }
    saveConfig();
    const visible = getVisibleGamesSorted();
    steamStarters = visible.map(game => new classes_1.SteamStarter(game.user, game.steamID, 'steam'));
    electron_1.BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('games-loaded', visible);
        win.webContents.send('config-updated');
    });
});
// Retrieve stored password for a given (user, steamID)
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
    if (typeof steamID !== 'number' || !Number.isInteger(steamID) || steamID <= 0) {
        return { success: false, error: 'Invalid steamID' };
    }
    const index = config.steamApps.findIndex(g => g.steamID === steamID);
    if (index === -1) {
        return { success: false, error: 'Game not found' };
    }
    const game = config.steamApps[index];
    game.hidden = !game.hidden;
    saveConfig();
    // Reload games to update the list
    const updatedGames = await fetchGames();
    steamStarters = updatedGames.map(game => new classes_1.SteamStarter(game.user, game.steamID, 'steam'));
    mainWindow?.webContents.send('games-loaded', updatedGames);
    // Notify all windows of config update
    electron_1.BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('config-updated');
    });
    return { success: true };
});
// Get all games including hidden ones
electron_1.ipcMain.handle('get-all-games', () => {
    return config.steamApps;
});
electron_1.ipcMain.handle('open-settings', async () => {
    createSettingsWindow();
});
// Start Steam client only (no -applaunch) for a given game index
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
        // Notify renderer: launching started
        electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-started', index));
        // Apply optional screen resolution as well for Steam-only (if set)
        await applyResolutionIfConfigured(index);
        const result = await starter.executeSteamOnly();
        // For Steam-only launch, watch the Steam client process rather than the game
        const procName = process.platform === 'win32' ? 'steam.exe' : 'steam';
        if (result.success) {
            const start = Date.now();
            const timeoutMs = 120000; // 120s timeout
            const initialDelayMs = 4000;
            const cmd = buildPgrepCmd(procName);
            let attempt = 0;
            const tick = () => {
                attempt++;
                if (Date.now() - start > timeoutMs) {
                    electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index));
                    return;
                }
                (0, child_process_1.exec)(cmd, (err, stdout, stderr) => {
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
const activeUpdates = new Map();
// Securely retrieve stored password for keytar/steamcmd use
async function getStoredPasswordForUpdate(steamID, user) {
    try {
        const keytar = (0, classes_1.loadKeytar)();
        const account = `${user}:${steamID}`;
        return await keytar.getPassword('steamlauncher', account);
    }
    catch (e) {
        if (VERBOSE)
            console.error('Failed to retrieve password for update:', e);
        return null;
    }
}
// Trigger asynchronous steamcmd update process
electron_1.ipcMain.handle('update-game', async (event, steamID) => {
    try {
        if (activeUpdates.has(steamID)) {
            return { success: false, error: 'Update already in progress for this game' };
        }
        const game = config.steamApps.find(g => g.steamID === steamID);
        if (!game) {
            return { success: false, error: 'Game not found in configuration' };
        }
        // 1. Locate Game Install Folder
        let acfPath = null;
        let steamappsDir = null;
        for (const cp of config.compatdataPaths) {
            const fullPath = cp.replace('~', os.homedir());
            const sAppsDir = node_path_1.default.resolve(fullPath, '..');
            const checkPath = node_path_1.default.join(sAppsDir, `appmanifest_${steamID}.acf`);
            if (fs.existsSync(checkPath)) {
                acfPath = checkPath;
                steamappsDir = sAppsDir;
                break;
            }
        }
        if (!acfPath || !steamappsDir) {
            return { success: false, error: 'Could not locate appmanifest file for game' };
        }
        const content = fs.readFileSync(acfPath, 'utf8');
        const match = content.match(/^\s*"installdir"\s*"([^"]+)"/mi);
        if (!match) {
            return { success: false, error: 'Could not parse installdir from appmanifest file' };
        }
        const installdir = match[1];
        const gamePath = node_path_1.default.join(steamappsDir, 'common', installdir);
        // 2. Retrieve Stored Password
        const password = await getStoredPasswordForUpdate(steamID, game.user);
        if (!password) {
            return { success: false, error: 'No password stored for this game account. Please configure credentials.' };
        }
        // 3. Spawn steamcmd process
        const logPath = node_path_1.default.join(electron_1.app.getPath('userData'), `steamcmd_update_${steamID}.log`);
        try {
            fs.writeFileSync(logPath, `=== SteamCMD Update Log for ${game.name} (AppID ${steamID}) ===\nStarted: ${new Date().toISOString()}\nPath: ${gamePath}\nUser: ${game.user}\nLocal buildID: ${getLocalBuildID(steamID) || 'Unknown'}\n\n`);
        }
        catch (logErr) {
            console.error('Failed to create update log file:', logErr);
        }
        console.log(`[SteamLauncher Update ${steamID}] Spawning steamcmd. Log file: ${logPath}`);
        electron_1.BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('update-progress', { steamID, status: 'checking', progress: 0, bytesDownloaded: 0, bytesTotal: 0 });
        });
        const tempHome = node_path_1.default.join(electron_1.app.getPath('userData'), 'steamcmd_home');
        try {
            fs.mkdirSync(tempHome, { recursive: true });
        }
        catch (err) {
            // Ignore folder already exists errors
        }
        const child = (0, child_process_1.spawn)('steamcmd', [], {
            env: {
                ...process.env,
                HOME: tempHome
            },
            detached: true
        });
        const session = { steamID, child, user: game.user, loginState: 'SPAWNED' };
        activeUpdates.set(steamID, session);
        const escapeSteamcmdArg = (arg) => {
            return '"' + arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        };
        const escapedGamePath = escapeSteamcmdArg(gamePath);
        const escapedUser = escapeSteamcmdArg(game.user);
        const escapedPassword = escapeSteamcmdArg(password);
        if (child.stdin) {
            child.stdin.write(`force_install_dir ${escapedGamePath}\n`);
            child.stdin.write(`login ${escapedUser} ${escapedPassword}\n`);
            session.loginState = 'LOGGING_IN';
        }
        let accumulatedStdout = '';
        let guardPrompted = false;
        const recentLines = [];
        const appendToLog = (text) => {
            try {
                fs.appendFileSync(logPath, text);
            }
            catch (e) {
                console.error('Failed appending to update log:', e);
            }
        };
        child.stdout.on('data', (data) => {
            const chunk = data.toString();
            accumulatedStdout += chunk;
            appendToLog(chunk);
            if (VERBOSE)
                process.stdout.write(`[steamcmd ${steamID}] ${chunk}`);
            // Detect Steam Guard (2FA) & Interactive Login
            if (session.loginState === 'LOGGING_IN' && !guardPrompted && (accumulatedStdout.includes('Steam Guard code') ||
                accumulatedStdout.includes('Two-factor code') ||
                accumulatedStdout.includes('Google Authenticator code') ||
                accumulatedStdout.includes('Enter code:') ||
                accumulatedStdout.includes('Enter the current'))) {
                guardPrompted = true;
                session.loginState = 'AWAITING_2FA';
                electron_1.BrowserWindow.getAllWindows().forEach(win => {
                    win.webContents.send('steam-guard-required', { steamID, user: game.user });
                    win.webContents.send('update-progress', { steamID, status: '2fa', progress: 0, bytesDownloaded: 0, bytesTotal: 0 });
                });
            }
            // Detect Login Success
            const hasUserInfo = accumulatedStdout.includes('Waiting for user info...');
            const hasUserInfoSuccess = hasUserInfo && (accumulatedStdout.indexOf('OK', accumulatedStdout.indexOf('Waiting for user info...')) !== -1 ||
                accumulatedStdout.indexOf('Steam>', accumulatedStdout.indexOf('Waiting for user info...')) !== -1);
            const hasLoggedIn = accumulatedStdout.includes('Logged in OK') || accumulatedStdout.includes('Logged in') || accumulatedStdout.includes('Success!');
            if ((session.loginState === 'LOGGING_IN' || session.loginState === 'AWAITING_2FA') && (hasUserInfoSuccess || hasLoggedIn)) {
                session.loginState = 'UPDATING';
                if (VERBOSE)
                    vlog(`SteamCMD Login Success. Initiating app_update ${steamID}`);
                if (child.stdin) {
                    child.stdin.write(`app_update ${steamID}\n`);
                    child.stdin.write('quit\n');
                }
            }
            // Detect Login Failure
            if ((session.loginState === 'LOGGING_IN' || session.loginState === 'AWAITING_2FA') && (accumulatedStdout.includes('FAILED with result code') ||
                accumulatedStdout.includes('Login Failed') ||
                accumulatedStdout.includes('Password invalid'))) {
                if (VERBOSE)
                    vlog(`SteamCMD Login Failed for ${game.user}`);
                child.kill();
            }
            // Parse lines for progress and error context
            const lines = chunk.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) {
                    recentLines.push(trimmed);
                    if (recentLines.length > 15) {
                        recentLines.shift();
                    }
                }
                // Parse progress: progress: 45.23 (1209384 / 2673849)
                const progressRegex = /progress:\s+([\d.]+)\s+\((\d+)\s+\/\s+(\d+)\)/;
                const match = line.match(progressRegex);
                if (match) {
                    const progress = parseFloat(match[1]);
                    const bytesDownloaded = parseInt(match[2], 10);
                    const bytesTotal = parseInt(match[3], 10);
                    let status = 'updating';
                    if (line.toLowerCase().includes('download')) {
                        status = 'downloading';
                    }
                    else if (line.toLowerCase().includes('verify') || line.toLowerCase().includes('validate')) {
                        status = 'validating';
                    }
                    else if (line.toLowerCase().includes('preallocat')) {
                        status = 'preallocating';
                    }
                    electron_1.BrowserWindow.getAllWindows().forEach(win => {
                        win.webContents.send('update-progress', { steamID, status, progress, bytesDownloaded, bytesTotal });
                    });
                }
            }
        });
        child.stderr.on('data', (data) => {
            const chunk = data.toString();
            appendToLog(chunk);
            console.error(`[steamcmd ${steamID} stderr] ${chunk}`);
            const lines = chunk.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) {
                    recentLines.push(`[stderr] ${trimmed}`);
                    if (recentLines.length > 15) {
                        recentLines.shift();
                    }
                }
            }
        });
        child.on('error', (err) => {
            const errMsg = `Failed to start steamcmd process: ${err.message}`;
            appendToLog(`\nERROR: ${errMsg}\n`);
            console.error(`[steamcmd ${steamID} error]`, err);
            activeUpdates.delete(steamID);
            electron_1.BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('update-progress', { steamID, status: 'failed', progress: 0, bytesDownloaded: 0, bytesTotal: 0, error: `${errMsg}\n\nFull log: ${logPath}` });
            });
        });
        child.on('close', async (code) => {
            const endMsg = `Process exited with code ${code}`;
            appendToLog(`\n${endMsg}\n`);
            console.log(`[steamcmd ${steamID}] ${endMsg}`);
            activeUpdates.delete(steamID);
            // Verify if the update completed successfully by checking if the stdout contains the success message
            const lowerStdout = accumulatedStdout.toLowerCase();
            const updateSuccess = lowerStdout.includes(`success! app '${steamID}'`);
            // Post-install manifest/dependency sync and cleanup
            const nestedSteamappsDir = node_path_1.default.join(gamePath, 'steamapps');
            if (fs.existsSync(nestedSteamappsDir)) {
                try {
                    if (updateSuccess) {
                        appendToLog(`Syncing manifests and dependency directories from: ${nestedSteamappsDir} to ${steamappsDir}\n`);
                        // 1. Copy common/ subdirectory contents (dependencies like runtimes or other tools)
                        const nestedCommon = node_path_1.default.join(nestedSteamappsDir, 'common');
                        if (fs.existsSync(nestedCommon)) {
                            const destCommon = node_path_1.default.join(steamappsDir, 'common');
                            fs.mkdirSync(destCommon, { recursive: true });
                            const commonEntries = fs.readdirSync(nestedCommon);
                            for (const entry of commonEntries) {
                                const srcEntryPath = node_path_1.default.join(nestedCommon, entry);
                                const destEntryPath = node_path_1.default.join(destCommon, entry);
                                appendToLog(`Moving nested dependency folder: ${entry} to ${destCommon}\n`);
                                fs.cpSync(srcEntryPath, destEntryPath, { recursive: true });
                            }
                        }
                        // 2. Copy manifest (.acf) files
                        const files = fs.readdirSync(nestedSteamappsDir);
                        for (const file of files) {
                            const srcFile = node_path_1.default.join(nestedSteamappsDir, file);
                            const destFile = node_path_1.default.join(steamappsDir, file);
                            const stat = fs.statSync(srcFile);
                            if (stat.isFile() && file.endsWith('.acf')) {
                                fs.copyFileSync(srcFile, destFile);
                                appendToLog(`Copied manifest ${file} to ${steamappsDir}\n`);
                            }
                        }
                    }
                    else {
                        appendToLog(`Discarding nested directory sync (update failed or cancelled).\n`);
                    }
                    // 3. Clean up the nested directories/files recursively in all cases
                    fs.rmSync(nestedSteamappsDir, { recursive: true, force: true });
                    appendToLog(`Cleaned up nested steamapps directory.\n`);
                }
                catch (syncErr) {
                    const syncErrMsg = `Failed to sync nested manifest/dependency files: ${syncErr.message}`;
                    console.error(syncErrMsg);
                    appendToLog(`ERROR: ${syncErrMsg}\n`);
                }
            }
            // Run checkGameUpdate to verify if update succeeded
            await checkGameUpdate(steamID, true);
            const gameAfterCheck = config.steamApps.find(g => g.steamID === steamID);
            if (gameAfterCheck && updateSuccess) {
                gameAfterCheck.updateAvailable = false;
                gameAfterCheck.lastUpdateCheck = Date.now();
                saveConfig();
            }
            const success = gameAfterCheck ? !gameAfterCheck.updateAvailable : false;
            appendToLog(`Post-update verification: success=${success}, localBuildID=${getLocalBuildID(steamID) || 'Unknown'}\n`);
            if (success) {
                if (code !== 0 && code !== 139) { // Treat segfault 139 on exit as warning rather than failure
                    appendToLog(`Warning: Process exited with non-zero code ${code}, but manifest was updated successfully.\n`);
                }
                electron_1.BrowserWindow.getAllWindows().forEach(win => {
                    win.webContents.send('update-progress', { steamID, status: 'completed', progress: 100, bytesDownloaded: 0, bytesTotal: 0 });
                    win.webContents.send('games-loaded', getVisibleGamesSorted());
                });
            }
            else {
                const preview = recentLines.join('\n');
                const errorMsg = `Process exited with code ${code}. Update verification failed.\n\nLast output:\n${preview}\n\nFull log: ${logPath}`;
                console.error(`[SteamLauncher Update ${steamID} failed] ${errorMsg}`);
                electron_1.BrowserWindow.getAllWindows().forEach(win => {
                    win.webContents.send('update-progress', { steamID, status: 'failed', progress: 0, bytesDownloaded: 0, bytesTotal: 0, error: errorMsg });
                });
            }
        });
        return { success: true };
    }
    catch (error) {
        if (VERBOSE)
            console.error(`Failed to trigger update for AppID ${steamID}:`, error);
        return { success: false, error: error.message };
    }
});
// Submit interactive Steam Guard code
electron_1.ipcMain.handle('submit-steam-guard', async (event, steamID, code) => {
    const session = activeUpdates.get(steamID);
    if (session && session.child && session.child.stdin) {
        if (VERBOSE)
            vlog(`Submitting Steam Guard code for ${steamID}`);
        session.loginState = 'LOGGING_IN';
        session.child.stdin.write(code + '\n');
        return { success: true };
    }
    return { success: false, error: 'No active update session found' };
});
// Cancel active update session
electron_1.ipcMain.handle('cancel-update', async (event, steamID) => {
    const session = activeUpdates.get(steamID);
    if (session) {
        if (VERBOSE)
            vlog(`Cancelling update for ${steamID}`);
        if (session.child) {
            try {
                process.kill(-session.child.pid, 'SIGTERM');
            }
            catch (err) {
                session.child.kill();
            }
        }
        activeUpdates.delete(steamID);
        return { success: true };
    }
    return { success: false, error: 'No active update session found' };
});
// Retrieve current application version from package.json
electron_1.ipcMain.handle('get-app-version', () => {
    return electron_1.app.getVersion();
});
// Manually refresh game library
electron_1.ipcMain.handle('refresh-games', async () => {
    const games = await fetchGames();
    steamStarters = games.map(game => new classes_1.SteamStarter(game.user, game.steamID, 'steam'));
    electron_1.BrowserWindow.getAllWindows().forEach(win => win.webContents.send('games-loaded', games));
    triggerBackgroundUpdateChecks(true);
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
// Unregister all shortcuts on quit
electron_1.app.on('will-quit', () => {
    electron_1.globalShortcut.unregisterAll();
});
electron_1.app.on('before-quit', () => {
    isQuitting = true;
});
//# sourceMappingURL=main.js.map
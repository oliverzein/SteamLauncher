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
exports.steamService = void 0;
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const config_service_1 = require("./config.service");
const helpers_1 = require("../utils/helpers");
class SteamService {
    VERBOSE = !!process.env.SL_VERBOSE;
    vlog = (...args) => { if (this.VERBOSE)
        console.log('[verbose]', ...args); };
    getRunningSteamLogin() {
        return new Promise((resolve) => {
            (0, child_process_1.exec)("pgrep -x -a steam", (err, stdout) => {
                if (err || !stdout)
                    return resolve(null);
                const lines = stdout.split('\n').filter(Boolean);
                for (const line of lines) {
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
    async ensureSteamUserOrShutdown(desiredUser) {
        try {
            const runningUser = await this.getRunningSteamLogin();
            if (!runningUser)
                return;
            if (runningUser === desiredUser)
                return;
            (0, child_process_1.exec)('steam -shutdown', () => { });
            const start = Date.now();
            const timeoutMs = 30000;
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
            // Ignore failures
        }
    }
    async applyResolutionIfConfigured(game) {
        try {
            const res = game.resolution?.trim();
            if (!res)
                return;
            const { code } = await (0, helpers_1.run)(`kscreen-doctor ${res}`);
            if (code !== 0) {
                // silently ignore non-zero exit
            }
        }
        catch (e) {
            // silently ignore resolution errors
        }
    }
    getLocalBuildID(steamID) {
        try {
            for (const cp of config_service_1.configService.getConfig().compatdataPaths) {
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
            if (this.VERBOSE)
                console.error(`Failed to get local build ID for ${steamID}:`, error);
        }
        return null;
    }
    getRemoteBuildID(steamID) {
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
                            if (this.VERBOSE)
                                this.vlog(`Fetched remote buildID ${buildID} for AppID ${steamID} from Web-API`);
                            return resolve(buildID);
                        }
                    }
                    catch (e) {
                        if (this.VERBOSE)
                            console.error(`Failed to parse Web-API JSON for AppID ${steamID}:`, e);
                    }
                    runSteamcmdFallback();
                });
            });
            req.on('error', (err) => {
                if (this.VERBOSE)
                    console.error(`Web-API error for AppID ${steamID}:`, err);
                runSteamcmdFallback();
            });
            req.setTimeout(5000, () => {
                if (this.VERBOSE)
                    console.warn(`Web-API timeout for AppID ${steamID}`);
                req.destroy();
                runSteamcmdFallback();
            });
            const runSteamcmdFallback = () => {
                if (this.VERBOSE)
                    this.vlog(`Running steamcmd fallback to get remote buildID for AppID ${steamID}`);
                const cmd = `steamcmd +login anonymous +app_info_update 1 +app_info_print ${steamID} +quit`;
                const tempHome = node_path_1.default.join(electron_1.app.getPath('userData'), 'steamcmd_home');
                try {
                    fs.mkdirSync(tempHome, { recursive: true });
                }
                catch (err) {
                    // Ignore
                }
                (0, child_process_1.exec)(cmd, { env: { ...process.env, HOME: tempHome } }, (error, stdout) => {
                    if (error) {
                        if (this.VERBOSE)
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
                                if (this.VERBOSE)
                                    this.vlog(`Fetched remote buildID ${buildID} for AppID ${steamID} from SteamCMD`);
                                return resolve(buildID);
                            }
                        }
                        const simpleMatch = stdout.match(/"buildid"\s*"(\d+)"/i);
                        if (simpleMatch) {
                            return resolve(simpleMatch[1]);
                        }
                    }
                    catch (e) {
                        if (this.VERBOSE)
                            console.error(`Failed to parse SteamCMD output for AppID ${steamID}:`, e);
                    }
                    resolve(null);
                });
            };
        });
    }
    async checkGameUpdate(steamID, force = false) {
        const config = config_service_1.configService.getConfig();
        const game = config.steamApps.find(g => g.steamID === steamID);
        if (!game)
            return false;
        const now = Date.now();
        const twelveHoursMs = 12 * 60 * 60 * 1000;
        if (!force && game.lastUpdateCheck && (now - game.lastUpdateCheck < twelveHoursMs)) {
            if (this.VERBOSE)
                this.vlog(`Skipping update check for AppID ${steamID} (already checked recently)`);
            return !!game.updateAvailable;
        }
        const localBuildID = this.getLocalBuildID(steamID);
        if (!localBuildID) {
            if (this.VERBOSE)
                this.vlog(`No local buildID found for AppID ${steamID}`);
            return false;
        }
        const remoteBuildID = await this.getRemoteBuildID(steamID);
        if (!remoteBuildID) {
            if (this.VERBOSE)
                console.warn(`Failed to fetch remote buildID for AppID ${steamID}`);
            return !!game.updateAvailable;
        }
        const updateAvailable = localBuildID !== remoteBuildID;
        const oldUpdate = game.updateAvailable;
        const oldCheck = game.lastUpdateCheck;
        game.updateAvailable = updateAvailable;
        game.lastUpdateCheck = now;
        if (oldUpdate !== updateAvailable || oldCheck !== now) {
            config_service_1.configService.saveConfig();
        }
        if (this.VERBOSE) {
            this.vlog(`AppID ${steamID} buildID compare: Local=${localBuildID}, Remote=${remoteBuildID}. UpdateAvailable=${updateAvailable}`);
        }
        return updateAvailable;
    }
    async triggerBackgroundUpdateChecks(force = false) {
        if (this.VERBOSE)
            this.vlog(`Starting background update checks (force=${force}) for all games...`);
        const visible = config_service_1.configService.getVisibleGamesSorted();
        for (const game of visible) {
            try {
                await this.checkGameUpdate(game.steamID, force);
                electron_1.BrowserWindow.getAllWindows().forEach(win => {
                    win.webContents.send('games-loaded', config_service_1.configService.getVisibleGamesSorted());
                });
            }
            catch (e) {
                if (this.VERBOSE)
                    console.error(`Error checking update for AppID ${game.steamID}:`, e);
            }
        }
    }
    async fetchAppDetails(steamID) {
        return new Promise((resolve) => {
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
                        if (this.VERBOSE)
                            console.error(`Failed API for steamID ${steamID}:`, e);
                        resolve({ name: `Game ${steamID}` });
                    }
                });
            }).on('error', (err) => {
                if (this.VERBOSE)
                    console.error(`Failed API for steamID ${steamID}:`, err);
                resolve({ name: `Game ${steamID}` });
            });
        });
    }
    async fetchGames() {
        const config = config_service_1.configService.getConfig();
        const games = [];
        const steamIDs = new Set();
        for (const pathStr of config.compatdataPaths) {
            try {
                const fullPath = pathStr.replace('~', os.homedir());
                if (this.VERBOSE)
                    this.vlog(`Using compatdata path: ${fullPath}`);
                const entries = fs.readdirSync(fullPath);
                if (this.VERBOSE)
                    this.vlog(`Found ${entries.length} entries in compatdata`);
                const filteredEntries = entries.filter(entry => /^\d+$/.test(entry));
                if (this.VERBOSE)
                    this.vlog(`Filtered steamIDs: [ ${filteredEntries.join(', ')} ]`);
                for (const entry of filteredEntries) {
                    const steamID = parseInt(entry);
                    if (steamID > 0 && steamID !== 1493710 && !steamIDs.has(steamID)) {
                        steamIDs.add(steamID);
                        let gameConfig = config.steamApps.find(g => g.steamID === steamID);
                        if (!gameConfig) {
                            gameConfig = {
                                name: `Game ${steamID}`,
                                user: 'default_user',
                                steamID: steamID,
                                hidden: false,
                                processName: undefined,
                                order: config_service_1.configService.getNextOrderValue(),
                            };
                            config.steamApps.push(gameConfig);
                        }
                        if (typeof gameConfig.order !== 'number') {
                            gameConfig.order = config_service_1.configService.getNextOrderValue();
                        }
                        const details = await this.fetchAppDetails(steamID);
                        gameConfig.name = details.name;
                        gameConfig.icon = details.icon;
                        if (!gameConfig.hidden) {
                            games.push(gameConfig);
                        }
                    }
                }
            }
            catch (error) {
                if (this.VERBOSE)
                    console.error(`Failed to read compatdata path ${pathStr}:`, error);
            }
        }
        config_service_1.configService.reindexGameOrders();
        games.sort(config_service_1.configService.compareByOrder);
        return games;
    }
}
exports.steamService = new SteamService();
//# sourceMappingURL=steam.service.js.map
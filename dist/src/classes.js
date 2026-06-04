"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SteamStarter = void 0;
exports.loadKeytar = loadKeytar;
const child_process_1 = require("child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_module_1 = require("node:module");
function loadKeytar() {
    const req = (0, node_module_1.createRequire)(__filename);
    try {
        return req('keytar');
    }
    catch {
        try {
            const altUnpacked = node_path_1.default.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'keytar');
            return req(altUnpacked);
        }
        catch {
            try {
                const altResources = node_path_1.default.join(process.resourcesPath, 'keytar');
                return req(altResources);
            }
            catch {
                const altNodeModules = node_path_1.default.join(process.resourcesPath, 'node_modules', 'keytar');
                return req(altNodeModules);
            }
        }
    }
}
class AppStarter {
    executablePath;
    executableArgs;
    constructor(executablePath, executableArgs) {
        this.executablePath = executablePath;
        this.executableArgs = executableArgs;
    }
    execute() {
        return new Promise((resolve, reject) => {
            try {
                const child = (0, child_process_1.spawn)(this.executablePath, this.executableArgs, {
                    stdio: 'ignore'
                });
                resolve({ success: true, pid: child.pid });
            }
            catch (error) {
                console.error('Failed to start executable:', error);
                reject({ success: false, error: error.message });
            }
        });
    }
}
class SteamStarter extends AppStarter {
    user;
    steamID;
    constructor(user, steamID, executablePath) {
        // will populate args at execute time once password is fetched from keytar
        super(executablePath, []);
        this.user = user;
        this.steamID = steamID;
    }
    // fallow-ignore-next-line unused-class-member
    async execute() {
        try {
            const keytar = loadKeytar();
            const account = `${this.user}:${this.steamID}`;
            const password = await keytar.getPassword('steamlauncher', account);
            if (!password) {
                return { success: false, error: 'No password stored for this game/user. Please configure credentials.' };
            }
            this.executableArgs = ['-login', this.user, password, '-applaunch', this.steamID.toString()];
            const child = (0, child_process_1.spawn)(this.executablePath, this.executableArgs, { stdio: 'ignore' });
            return { success: true, pid: child.pid };
        }
        catch (error) {
            console.error('Failed to start executable:', error);
            return { success: false, error: error.message };
        }
    }
    // Start Steam for this account without launching the game (omit -applaunch)
    // fallow-ignore-next-line unused-class-member
    async executeSteamOnly() {
        try {
            const keytar = loadKeytar();
            const account = `${this.user}:${this.steamID}`;
            const password = await keytar.getPassword('steamlauncher', account);
            if (!password) {
                return { success: false, error: 'No password stored for this game/user. Please configure credentials.' };
            }
            this.executableArgs = ['-login', this.user, password];
            const child = (0, child_process_1.spawn)(this.executablePath, this.executableArgs, { stdio: 'ignore' });
            return { success: true, pid: child.pid };
        }
        catch (error) {
            console.error('Failed to start Steam only:', error);
            return { success: false, error: error.message };
        }
    }
}
exports.SteamStarter = SteamStarter;
//# sourceMappingURL=classes.js.map
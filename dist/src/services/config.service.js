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
exports.configService = void 0;
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const fs = __importStar(require("fs"));
class ConfigService {
    config = {
        compatdataPaths: ['~/.local/share/Steam/steamapps/compatdata/'],
        steamApps: [],
        startMinimized: false,
    };
    getConfig() {
        return this.config;
    }
    setConfig(newConfig) {
        this.config = newConfig;
    }
    loadConfig() {
        try {
            const configPath = node_path_1.default.join(electron_1.app.getPath('userData'), 'config.json');
            if (fs.existsSync(configPath)) {
                const data = fs.readFileSync(configPath, 'utf8');
                const parsed = JSON.parse(data);
                if (parsed.compatdataPath && !parsed.compatdataPaths) {
                    parsed.compatdataPaths = [parsed.compatdataPath];
                    delete parsed.compatdataPath;
                }
                this.config = { ...this.config, ...parsed };
                this.reindexGameOrders();
                this.saveConfig();
            }
        }
        catch (error) {
            console.error('Failed to load config:', error);
        }
    }
    saveConfig(newConfig) {
        if (newConfig) {
            this.config = { ...this.config, ...newConfig };
        }
        try {
            const configPath = node_path_1.default.join(electron_1.app.getPath('userData'), 'config.json');
            const sanitized = {
                ...this.config,
                steamApps: this.config.steamApps.map(g => ({
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
            const VERBOSE = !!process.env.SL_VERBOSE;
            if (VERBOSE)
                console.error('Failed to save config:', error);
        }
    }
    compareByOrder = (a, b) => {
        const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
        const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
        if (ao !== bo)
            return ao - bo;
        return a.name.localeCompare(b.name);
    };
    getNextOrderValue() {
        let max = -1;
        for (const game of this.config.steamApps) {
            if (typeof game.order === 'number' && game.order > max) {
                max = game.order;
            }
        }
        return max + 1;
    }
    reindexGameOrders() {
        const sorted = [...this.config.steamApps].sort(this.compareByOrder);
        sorted.forEach((game, index) => {
            game.order = index;
        });
    }
    getVisibleGamesSorted() {
        return this.config.steamApps.filter(game => !game.hidden).sort(this.compareByOrder);
    }
}
exports.configService = new ConfigService();
//# sourceMappingURL=config.service.js.map
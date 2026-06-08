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
exports.waitForDevServer = waitForDevServer;
exports.run = run;
exports.buildPgrepCmd = buildPgrepCmd;
exports.getAppIconPath = getAppIconPath;
const child_process_1 = require("child_process");
const node_path_1 = __importDefault(require("node:path"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
function waitForDevServer(urlStr, overallTimeoutMs = 10000, retryIntervalMs = 200) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const attempt = () => {
            try {
                const u = new URL(urlStr);
                const getter = u.protocol === 'https:' ? https.get : http.get;
                const req = getter(urlStr, (res) => {
                    if (res.statusCode && res.statusCode < 500) {
                        res.resume();
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
function run(cmd) {
    return new Promise((resolve) => {
        (0, child_process_1.exec)(cmd, (error, stdout, stderr) => {
            resolve({ code: error ? error.code ?? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
        });
    });
}
function buildPgrepCmd(raw) {
    const name = node_path_1.default.basename(raw);
    const escaped = name.replace(/'/g, "'\\''");
    return `pgrep -fi '${escaped}'`;
}
function resolveAsset(...segments) {
    const devPath = node_path_1.default.join(__dirname, '..', '..', 'assets', ...segments);
    const prodPath = node_path_1.default.join(process.resourcesPath, 'assets', ...segments);
    return fs.existsSync(devPath) ? devPath : prodPath;
}
function getAppIconPath() {
    const pngPath = resolveAsset('app-icon.png');
    if (fs.existsSync(pngPath))
        return pngPath;
    const altPng = resolveAsset('icon.png');
    if (fs.existsSync(altPng))
        return altPng;
    return undefined;
}
//# sourceMappingURL=helpers.js.map